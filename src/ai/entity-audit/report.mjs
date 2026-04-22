// Post-apply impact report for the entity-audit pass.
//
// Reads the corpus + current aliases, prints:
//   - Per-label counts: total entities, deleted, merged
//   - Top 30 noise-candidates remaining (highest-mention non-deleted
//     non-merged entities that aren't flagged by DELETE_ALWAYS already)
//   - DELETE_ALWAYS coverage stats
//
// CLI:
//   node src/ai/entity-audit/report.mjs
//   node src/ai/entity-audit/report.mjs --label person

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../../../dist/graph/aliases-schema.js";
import { DELETE_ALWAYS, ALWAYS_PROMOTE } from "../../../dist/ai/curate/delete-always.js";

const dataDir = "data";
const args = process.argv.slice(2);
const labelFlag = (() => {
  const i = args.indexOf("--label");
  return i >= 0 ? args[i + 1] : null;
})();

function normalize(s) { return String(s).toLowerCase().trim().replace(/\s+/g, " "); }

const entDir = join(dataDir, "entities");
const entFiles = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
);
const corpus = new Map();
for (const f of entFiles) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    const key = `${m.label}:${normalize(m.canonical)}`;
    if (!corpus.has(key)) corpus.set(key, { label: m.label, canonical: m.canonical, total: 0, videos: new Set() });
    const ent = corpus.get(key);
    ent.total++;
    ent.videos.add(vid);
  }
}

const aliases = readAliasesFile(dataDir);
const deleted = new Set(aliases.deletedEntities.map((e) => e.key));
const mergedFrom = new Set(aliases.merges.map((e) => e.from));
const deleteAlwaysSet = new Set(DELETE_ALWAYS.map((e) => e.key));
const alwaysPromoteFrom = new Set(ALWAYS_PROMOTE.map((e) => e.from));

// Per-label stats
const perLabel = new Map();
for (const [key, ent] of corpus) {
  if (labelFlag && ent.label !== labelFlag) continue;
  if (!perLabel.has(ent.label)) {
    perLabel.set(ent.label, {
      total: 0,
      deleted: 0,
      merged: 0,
      deleteAlwaysActive: 0,
      remainingActive: 0,
      remaining: [],
    });
  }
  const stats = perLabel.get(ent.label);
  stats.total++;
  if (deleted.has(key)) stats.deleted++;
  else if (mergedFrom.has(key)) stats.merged++;
  else {
    stats.remainingActive++;
    stats.remaining.push({ key, total: ent.total, videos: ent.videos.size });
  }
  if (deleteAlwaysSet.has(key)) stats.deleteAlwaysActive++;
}

for (const stats of perLabel.values()) {
  stats.remaining.sort((a, b) => b.total - a.total);
  stats.remaining = stats.remaining.slice(0, 30);
}

const summary = {
  corpusEntities: corpus.size,
  totalDeleted: aliases.deletedEntities.length,
  totalMerges: aliases.merges.length,
  totalVideoMerges: aliases.videoMerges.length,
  deleteAlwaysListSize: DELETE_ALWAYS.length,
  alwaysPromoteListSize: ALWAYS_PROMOTE.length,
  byLabel: Object.fromEntries(perLabel),
};

console.log(JSON.stringify(summary, null, 2));
