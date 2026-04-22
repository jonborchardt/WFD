// Plan 2-2 §B1 (plans2/02-entity-resolution.md).
//
// Build a per-video resolution bundle: ambiguous single-token persons
// (and optionally orgs) that need per-video coref resolution to a full
// canonical name. Writes
// _entity_resolution_tmp/<videoId>.bundle.json.
//
// CLI:
//   node src/ai/entity-resolution/prepare.mjs <videoId>
//   node src/ai/entity-resolution/prepare.mjs --video <id> --video <id2>
//   node src/ai/entity-resolution/prepare.mjs --random 3   # pick N random videos with eligible entities

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../../../dist/graph/aliases-schema.js";
import { DELETE_LABELS } from "../../../dist/ai/curate/delete-always.js";

const t0 = Date.now();
const dataDir = "data";
const outDir = "_entity_resolution_tmp";
const CONTEXT = 280;

const args = process.argv.slice(2);
function pickArg(flag) {
  const v = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) v.push(args[i + 1]);
  return v;
}
const explicitVideos = pickArg("--video");
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--video" && args[i - 1] !== "--random");
const randomN = Number(pickArg("--random")[0] ?? 0);

// ---- Config ----------------------------------------------------------
const LABELS_IN_SCOPE = new Set(["person"]); // start narrow — persons are where coref matters most
const MIN_NEIGHBOR_COUNT = 1; // at least 1 longer-form candidate in corpus

function normalize(s) { return String(s).toLowerCase().trim().replace(/\s+/g, " "); }
function tokens(s) { return normalize(s).split(" ").filter(Boolean); }

// ---- Load aliases ----------------------------------------------------
const aliases = readAliasesFile(dataDir);
const deletedKeys = new Set(aliases.deletedEntities.map((e) => e.key));
const mergedFrom = new Map(aliases.merges.map((e) => [e.from, e.to]));
const videoMergedFrom = new Set(aliases.videoMerges.map((e) => `${e.videoId}::${e.from}`));
const notSamePairs = new Set(aliases.notSame.map((e) => [e.a, e.b].sort().join("~~")));
const deleteLabelsSet = new Set(DELETE_LABELS.map((e) => e.label));

function resolveKey(key) {
  if (deletedKeys.has(key)) return null;
  const label = key.slice(0, key.indexOf(":"));
  if (deleteLabelsSet.has(label)) return null;
  let cur = key, hops = 0;
  while (mergedFrom.has(cur) && hops < 10) { cur = mergedFrom.get(cur); hops++; }
  if (deletedKeys.has(cur)) return null;
  return cur;
}

// ---- Build corpus map ------------------------------------------------
const entDir = join(dataDir, "entities");
const entFiles = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
);

const corpus = new Map(); // resolvedKey -> { canonical, total, videos: Set }
const perVideo = new Map(); // vid -> Map<resolvedKey, { mentions: [{...}], rawKey, canonical }>
for (const f of entFiles) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  const pv = new Map();
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    const rawKey = `${m.label}:${normalize(m.canonical)}`;
    const resolved = resolveKey(rawKey);
    if (!resolved) continue;
    // Track both unresolved (rawKey) for per-video work AND resolved for corpus neighbors
    if (!corpus.has(resolved)) corpus.set(resolved, { canonical: m.canonical, total: 0, videos: new Set() });
    const ent = corpus.get(resolved);
    ent.total++;
    ent.videos.add(vid);
    if (m.canonical.length > ent.canonical.length) ent.canonical = m.canonical;
    if (!pv.has(rawKey)) pv.set(rawKey, { rawKey, canonical: m.canonical, mentions: [] });
    pv.get(rawKey).mentions.push({
      charStart: m.span?.charStart ?? 0,
      charEnd: m.span?.charEnd ?? 0,
      timeStart: m.span?.timeStart ?? 0,
      surface: m.surface ?? m.canonical,
    });
  }
  perVideo.set(vid, pv);
}

// ---- Determine target videos ----------------------------------------
function isEligibleEntity(rawKey, label, canonical) {
  if (!LABELS_IN_SCOPE.has(label)) return false;
  const resolved = resolveKey(rawKey);
  if (!resolved) return false;
  // Single-token canonical (first-name-only person)
  const toks = tokens(canonical);
  if (toks.length !== 1) return false;
  if (toks[0].length < 3) return false;
  // Must have ≥ MIN neighbors in corpus with longer forms starting with this token
  const token = toks[0];
  let neighbors = 0;
  for (const [nkey, nent] of corpus) {
    if (nkey === resolved) continue;
    if (!nkey.startsWith(`${label}:`)) continue;
    const ntoks = tokens(nent.canonical);
    if (ntoks.length > 1 && ntoks.includes(token)) neighbors++;
    if (neighbors >= MIN_NEIGHBOR_COUNT) break;
  }
  return neighbors >= MIN_NEIGHBOR_COUNT;
}

let videoIds = [];
if (explicitVideos.length > 0) videoIds = explicitVideos;
else if (positional.length > 0) videoIds = positional;
else if (randomN > 0) {
  // Rank videos by #eligible entities, pick randomly from top-50
  const scored = [];
  for (const [vid, pv] of perVideo) {
    let count = 0;
    for (const [rawKey, ent] of pv) {
      const label = rawKey.slice(0, rawKey.indexOf(":"));
      if (isEligibleEntity(rawKey, label, ent.canonical)) count++;
    }
    if (count > 0) scored.push({ vid, count });
  }
  scored.sort((a, b) => b.count - a.count);
  const pool = scored.slice(0, 50);
  const shuffled = pool.map((x) => ({ ...x, r: Math.random() })).sort((a, b) => a.r - b.r);
  videoIds = shuffled.slice(0, randomN).map((x) => x.vid);
}

if (videoIds.length === 0) {
  console.error("no videos specified; use --video <id> or --random N");
  process.exit(1);
}

// ---- Neighbors helper -----------------------------------------------
function findNeighbors(resolvedKey, label, token) {
  const out = [];
  for (const [nkey, nent] of corpus) {
    if (nkey === resolvedKey) continue;
    if (!nkey.startsWith(`${label}:`)) continue;
    const ntoks = tokens(nent.canonical);
    if (ntoks.length > 1 && ntoks.includes(token)) {
      out.push({
        key: nkey,
        canonical: nent.canonical,
        total: nent.total,
        videoCount: nent.videos.size,
      });
    }
  }
  out.sort((a, b) => b.total - a.total);
  return out.slice(0, 10);
}

// ---- Transcript cache for context extraction ------------------------
const transcriptCache = new Map();
function flattenTranscript(vid) {
  if (transcriptCache.has(vid)) return transcriptCache.get(vid);
  const p = join(dataDir, "transcripts", `${vid}.json`);
  if (!existsSync(p)) { transcriptCache.set(vid, null); return null; }
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { transcriptCache.set(vid, null); return null; }
  const text = (j.cues ?? []).map((c) => c.text ?? "").join("\n");
  transcriptCache.set(vid, text);
  return text;
}
function quoteAround(vid, charStart, charEnd) {
  const text = flattenTranscript(vid);
  if (text === null) return "";
  const before = Math.max(0, charStart - CONTEXT / 2);
  const after = Math.min(text.length, charEnd + CONTEXT / 2);
  return text.slice(before, after).replace(/\s+/g, " ").trim();
}

// ---- Build per-video bundles ----------------------------------------
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const summary = { videos: [], totalEntitiesBundled: 0, ms: 0 };
for (const vid of videoIds) {
  const pv = perVideo.get(vid);
  if (!pv) { summary.videos.push({ videoId: vid, skipped: "no entities" }); continue; }
  // Skip already-resolved-by-video-merge
  const items = [];
  for (const [rawKey, ent] of pv) {
    const label = rawKey.slice(0, rawKey.indexOf(":"));
    if (!isEligibleEntity(rawKey, label, ent.canonical)) continue;
    if (videoMergedFrom.has(`${vid}::${rawKey}`)) continue;
    const resolved = resolveKey(rawKey);
    const toks = tokens(ent.canonical);
    const neighbors = findNeighbors(resolved, label, toks[0]);
    if (neighbors.length === 0) continue;
    // Sample contexts (up to 5)
    const samples = [];
    for (const m of ent.mentions.slice(0, 5)) {
      const q = quoteAround(vid, m.charStart, m.charEnd);
      if (q) samples.push({ charStart: m.charStart, timeStart: m.timeStart, surface: m.surface, quote: q });
    }
    items.push({
      key: rawKey,
      canonical: ent.canonical,
      mentionCount: ent.mentions.length,
      sampleContexts: samples,
      candidateResolutions: neighbors,
    });
  }
  const bundle = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    videoId: vid,
    entitiesInScope: items.length,
    contextWindow: CONTEXT,
    entities: items,
  };
  const outPath = join(outDir, `${vid}.bundle.json`);
  writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
  summary.videos.push({ videoId: vid, entities: items.length, path: outPath });
  summary.totalEntitiesBundled += items.length;
}
summary.ms = Date.now() - t0;
console.log(JSON.stringify(summary, null, 2));
