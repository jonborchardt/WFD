// Plan 2-2 Part D: extraction-time canonical normalization.
//
// Walk every active entity key in the corpus, compute a "normalized
// canonical" (lowercase + strip titles/determiners/punctuation), and
// propose merges when two keys collapse to the same form. Emits to
// _entity_resolution_tmp/normalize.proposals.json for the same
// apply.mjs to consume.
//
// Code-only, no AI; safe to run idempotently.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../../../dist/graph/aliases-schema.js";
import { DELETE_LABELS } from "../../../dist/ai/curate/delete-always.js";

const dataDir = "data";
const t0 = Date.now();

const aliases = readAliasesFile(dataDir);
const deletedKeys = new Set(aliases.deletedEntities.map((e) => e.key));
const mergedFrom = new Map(aliases.merges.map((e) => [e.from, e.to]));
const notSamePairs = new Set(aliases.notSame.map((e) => [e.a, e.b].sort().join("~~")));
const deleteLabelsSet = new Set(DELETE_LABELS.map((e) => e.label));

function normalize(s) { return String(s).toLowerCase().trim().replace(/\s+/g, " "); }

// Strip titles, determiners, possessives, surplus whitespace.
const TITLE_PATTERNS = [
  /^dr\.\s+/i,
  /^dr\s+/i,
  /^mr\.\s+/i,
  /^mr\s+/i,
  /^mrs\.\s+/i,
  /^mrs\s+/i,
  /^ms\.\s+/i,
  /^ms\s+/i,
  /^sir\s+/i,
  /^dame\s+/i,
  /^lord\s+/i,
  /^lady\s+/i,
  /^professor\s+/i,
  /^prof\.\s+/i,
  /^prof\s+/i,
  /^rev\.\s+/i,
  /^reverend\s+/i,
  /^father\s+/i,
  /^saint\s+/i,
  /^st\.\s+/i,
  /^st\s+/i,
];
const DETERMINER = /^(the|a|an)\s+/i;

function normKey(canonical, label) {
  let s = canonical.toLowerCase().trim();
  // strip titles (only for person label)
  if (label === "person") {
    let prev;
    do {
      prev = s;
      for (const pat of TITLE_PATTERNS) s = s.replace(pat, "");
    } while (s !== prev);
  }
  // strip leading determiners (all labels)
  let prev2;
  do { prev2 = s; s = s.replace(DETERMINER, ""); } while (s !== prev2);
  // remove trailing possessive 's
  s = s.replace(/'s$/, "");
  // remove punctuation other than hyphen
  s = s.replace(/[^\p{L}\p{N}\s-]/gu, "");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function resolveKey(k) {
  if (deletedKeys.has(k)) return null;
  const label = k.slice(0, k.indexOf(":"));
  if (deleteLabelsSet.has(label)) return null;
  let cur = k, h = 0;
  while (mergedFrom.has(cur) && h < 10) { cur = mergedFrom.get(cur); h++; }
  if (deletedKeys.has(cur)) return null;
  return cur;
}

// Build corpus — only non-deleted, non-label-deleted, non-already-merged
const entDir = "data/entities";
const files = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos")
);
const corpus = new Map(); // resolvedKey -> { canonical, label, total }
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    const raw = `${m.label}:${normalize(m.canonical)}`;
    const r = resolveKey(raw);
    if (!r) continue;
    if (!corpus.has(r)) corpus.set(r, { canonical: m.canonical, label: m.label, total: 0 });
    corpus.get(r).total++;
    if (m.canonical.length > corpus.get(r).canonical.length) corpus.get(r).canonical = m.canonical;
  }
}

// Group by normalized form + label
const groups = new Map(); // `${label}::${normalized}` -> [{ key, canonical, total }]
for (const [key, ent] of corpus) {
  const nk = normKey(ent.canonical, ent.label);
  if (!nk) continue;
  // skip if normalized key is empty or too short after stripping
  if (nk.length < 2) continue;
  const groupKey = `${ent.label}::${nk}`;
  if (!groups.has(groupKey)) groups.set(groupKey, []);
  groups.get(groupKey).push({ key, canonical: ent.canonical, total: ent.total });
}

// Build proposals: for each group with >1 member, propose merges into the highest-mention member
const proposals = [];
let groupCount = 0;
for (const [, members] of groups) {
  if (members.length < 2) continue;
  groupCount++;
  members.sort((a, b) => b.total - a.total);
  const target = members[0];
  for (let i = 1; i < members.length; i++) {
    const src = members[i];
    if (src.key === target.key) continue;
    const pair = [src.key, target.key].sort().join("~~");
    if (notSamePairs.has(pair)) continue;
    proposals.push({
      verdict: "RESOLVE-CORPUS",
      from: src.key,
      to: target.key,
      rationale: `normalize-canonical collapse (${src.canonical} → ${target.canonical})`,
    });
  }
}

// Write as a proposals file that apply.mjs will consume.
// Give it a synthetic videoId that won't collide with any real video.
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  videoId: "__normalize__",
  agent: "normalize.mjs",
  summary: { total: proposals.length, resolvePerVideo: 0, resolveCorpus: proposals.length, keep: 0, defer: 0 },
  proposals,
};
const outPath = "_entity_resolution_tmp/__normalize__.proposals.json";
writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify({
  ms: Date.now() - t0,
  groupsWithCollisions: groupCount,
  proposedMerges: proposals.length,
  outPath,
}, null, 2));
