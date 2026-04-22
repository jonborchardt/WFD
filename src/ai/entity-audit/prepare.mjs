// Generate per-label audit bundles from the current corpus state.
//
// Each bundle lists tier-1 entities (top N by mention count within its
// label) plus ~5 context samples per entity, the corpus neighbors
// (entities in the same label whose canonical is a token-level subset
// or superset), and the current aliases-state for the entity.
//
// Plan 2-1 §B1 (plans2/01-entity-hygiene.md). Writes bundles to
// _entity_audit_tmp/<label>.bundle.json. Skips DELETE_ALWAYS-matched
// entities (they get handled automatically by the indexes hook).
//
// CLI:
//   node src/ai/entity-audit/prepare.mjs                 # all labels, tier 1
//   node src/ai/entity-audit/prepare.mjs --label person  # single label
//   node src/ai/entity-audit/prepare.mjs --tier 2        # tier 2 (≥5 videos)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DELETE_ALWAYS, ALWAYS_PROMOTE, DELETE_LABELS } from "../../../dist/ai/curate/delete-always.js";
import { readAliasesFile } from "../../../dist/graph/aliases-schema.js";

const DELETE_LABELS_SET = new Set(DELETE_LABELS.map((e) => e.label));

const t0 = Date.now();
const dataDir = "data";
const outDir = "_entity_audit_tmp";

// ---- CLI -------------------------------------------------------------
const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return args[i + 1];
}
const onlyLabel = arg("--label");
const tier = Number(arg("--tier") ?? 1);
const tierLimit = tier === 1 ? 100 : tier === 2 ? 500 : 2000;
const contextWindow = 260;

// ---- Helpers ---------------------------------------------------------
function normalize(s) {
  return String(s).toLowerCase().trim().replace(/\s+/g, " ");
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

// ---- Scan corpus -----------------------------------------------------
const entDir = join(dataDir, "entities");
const entFiles = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
);

const corpus = new Map(); // key -> { label, canonical, total, perVideo: Map<vid, {count, mentions:[{videoId,charStart,charEnd,timeStart,surface}]}> }

for (const f of entFiles) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    const key = `${m.label}:${normalize(m.canonical)}`;
    if (!corpus.has(key)) {
      corpus.set(key, {
        label: m.label,
        canonical: m.canonical,
        total: 0,
        perVideo: new Map(),
      });
    }
    const ent = corpus.get(key);
    ent.total++;
    if (m.canonical.length > ent.canonical.length) ent.canonical = m.canonical;
    if (!ent.perVideo.has(vid)) {
      ent.perVideo.set(vid, { count: 0, mentions: [] });
    }
    const pv = ent.perVideo.get(vid);
    pv.count++;
    if (pv.mentions.length < 3) {
      pv.mentions.push({
        videoId: vid,
        charStart: m.span?.charStart ?? 0,
        charEnd: m.span?.charEnd ?? 0,
        timeStart: m.span?.timeStart ?? 0,
        surface: m.surface ?? m.canonical,
      });
    }
  }
}

// ---- Current aliases state ------------------------------------------
const aliases = readAliasesFile(dataDir);
const deletedKeys = new Set(aliases.deletedEntities.map((e) => e.key));
const mergedFrom = new Map(aliases.merges.map((e) => [e.from, e.to]));
const deleteAlwaysSet = new Set(DELETE_ALWAYS.map((e) => e.key));
const alwaysPromoteFromSet = new Set(ALWAYS_PROMOTE.map((e) => e.from));

// ---- Build per-label buckets, rank by total mentions ---------------
const byLabel = new Map(); // label -> entries sorted by total desc
for (const [key, ent] of corpus) {
  if (onlyLabel && ent.label !== onlyLabel) continue;
  if (DELETE_LABELS_SET.has(ent.label)) continue;
  if (deletedKeys.has(key)) continue;
  if (deleteAlwaysSet.has(key)) continue;
  if (alwaysPromoteFromSet.has(key)) continue;
  // Allow already-merged entities through (we may want to re-examine),
  // but annotate.
  if (!byLabel.has(ent.label)) byLabel.set(ent.label, []);
  byLabel.get(ent.label).push({ key, ent });
}
for (const list of byLabel.values()) {
  list.sort((a, b) => b.ent.total - a.ent.total);
}

// Tier filter: tier 1 = top N by total; tier 2 = ≥5 videos; tier 3 = rest.
function tierFilter(entries) {
  if (tier === 1) return entries.slice(0, tierLimit);
  if (tier === 2) {
    return entries
      .filter(({ ent }) => ent.perVideo.size >= 5)
      .slice(0, tierLimit);
  }
  return entries.filter(({ ent }) => ent.total <= 5).slice(0, tierLimit);
}

// ---- Transcript cache for context extraction ------------------------
const transcriptCache = new Map();
function flattenTranscript(vid) {
  if (transcriptCache.has(vid)) return transcriptCache.get(vid);
  const p = join(dataDir, "transcripts", `${vid}.json`);
  if (!existsSync(p)) {
    transcriptCache.set(vid, null);
    return null;
  }
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { transcriptCache.set(vid, null); return null; }
  // Flatten same way the entities stage does: cues joined with "\n".
  const text = (j.cues ?? []).map((c) => c.text ?? "").join("\n");
  transcriptCache.set(vid, text);
  return text;
}

function quoteAround(vid, charStart, charEnd) {
  const text = flattenTranscript(vid);
  if (text === null) return "";
  const before = Math.max(0, charStart - contextWindow / 2);
  const after = Math.min(text.length, charEnd + contextWindow / 2);
  const raw = text.slice(before, after).replace(/\s+/g, " ").trim();
  return raw;
}

// ---- Corpus neighbors: entities in same label sharing tokens -----
function neighborsFor(key, ent, limit = 5) {
  const toks = new Set(tokens(ent.canonical));
  if (toks.size === 0) return [];
  const hits = [];
  for (const [otherKey, otherEnt] of corpus) {
    if (otherKey === key) continue;
    if (otherEnt.label !== ent.label) continue;
    const otherToks = tokens(otherEnt.canonical);
    let overlap = 0;
    for (const t of otherToks) if (toks.has(t)) overlap++;
    if (overlap === 0) continue;
    hits.push({ key: otherKey, overlap, canonical: otherEnt.canonical, total: otherEnt.total, videoCount: otherEnt.perVideo.size });
  }
  hits.sort((a, b) => b.overlap - a.overlap || b.total - a.total);
  return hits.slice(0, limit);
}

// ---- Pick sample contexts across videos ---------------------------
function sampleContexts(ent, maxSamples = 5, maxPerVideo = 2) {
  const out = [];
  // Prefer breadth: one sample per video, up to N videos, then fill
  const videos = [...ent.perVideo.entries()]
    .sort((a, b) => b[1].count - a[1].count);
  let round = 0;
  while (out.length < maxSamples && round < maxPerVideo) {
    for (const [vid, pv] of videos) {
      if (out.length >= maxSamples) break;
      const m = pv.mentions[round];
      if (!m) continue;
      const quote = quoteAround(vid, m.charStart, m.charEnd);
      if (!quote) continue;
      out.push({ videoId: vid, timeStart: m.timeStart, surface: m.surface, quote });
    }
    round++;
  }
  return out;
}

// ---- Assemble bundles ---------------------------------------------
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const summary = { tier, byLabel: {}, totalEntities: 0, ms: 0 };
const labels = onlyLabel ? [onlyLabel] : [...byLabel.keys()].sort();

for (const label of labels) {
  const list = byLabel.get(label) ?? [];
  const picked = tierFilter(list);
  const items = [];
  for (const { key, ent } of picked) {
    const perVideoCount = {};
    for (const [vid, pv] of ent.perVideo) perVideoCount[vid] = pv.count;
    items.push({
      key,
      label: ent.label,
      canonical: ent.canonical,
      totalMentions: ent.total,
      videoCount: ent.perVideo.size,
      perVideoCount,
      currentMerge: mergedFrom.get(key) ?? null,
      sampleContexts: sampleContexts(ent, 5, 2),
      corpusNeighbors: neighborsFor(key, ent, 8),
    });
  }
  const bundle = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tier,
    label,
    tierLimit,
    contextWindow,
    entitiesInLabel: list.length,
    entities: items,
  };
  const outPath = join(outDir, `tier-${tier}-${label}.bundle.json`);
  writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
  summary.byLabel[label] = {
    bundled: items.length,
    ofTotal: list.length,
    path: outPath,
  };
  summary.totalEntities += items.length;
}

summary.ms = Date.now() - t0;
console.log(JSON.stringify(summary, null, 2));
