// Apply _curate_tmp/proposals.json via typed mutators.
// Creates _curate_tmp/aliases.before.json backup before writing.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  addDeletedEntity, addMerge, addVideoMerge, readAliasesFile,
} from "../../../dist/graph/aliases-schema.js";

// The typed mutators don't touch the catalog; graph-level stages
// (indexes/propagation/…) only re-run when catalog.graph.dirtyAt advances.
// Direct aliases writes bypass the API surface, so we bump dirtyAt here.
function markGraphDirty(dataDir) {
  const p = `${dataDir}/catalog/catalog.json`;
  const c = JSON.parse(readFileSync(p, "utf8"));
  c.graph = c.graph ?? { stages: {} };
  c.graph.dirtyAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(c, null, 2), "utf8");
}

const t0 = Date.now();
const dataDir = "data";

// Safety backup
if (!existsSync("_curate_tmp/aliases.before.json")) {
  copyFileSync(`${dataDir}/aliases.json`, "_curate_tmp/aliases.before.json");
}

const proposals = JSON.parse(readFileSync("_curate_tmp/proposals.json", "utf8"));
const existing = readAliasesFile(dataDir);

const notSamePairs = new Set(
  existing.notSame.map((e) => [e.a, e.b].sort().join("~~"))
);
const alreadyDeleted = new Set(existing.deletedEntities.map((e) => e.key));
const alreadyMerged = new Set(existing.merges.map((e) => e.from));
const alreadyVideoMerged = new Set(
  existing.videoMerges.map((e) => `${e.videoId}::${e.from}`)
);

const applied = { videoMerges: 0, merges: 0, deletedEntities: 0 };
const skipped = [];

for (const e of proposals.videoMerges) {
  const k = `${e.videoId}::${e.from}`;
  if (alreadyVideoMerged.has(k)) { skipped.push(["videoMerge:already", e]); continue; }
  if (notSamePairs.has([e.from, e.to].sort().join("~~"))) {
    skipped.push(["videoMerge:notSame", e]); continue;
  }
  if (alreadyMerged.has(e.from) || alreadyDeleted.has(e.from)) {
    skipped.push(["videoMerge:handled", e]); continue;
  }
  addVideoMerge(dataDir, e.videoId, e.from, e.to);
  applied.videoMerges++;
}

for (const e of proposals.merges) {
  if (alreadyMerged.has(e.from) || alreadyDeleted.has(e.from)) {
    skipped.push(["merge:handled", e]); continue;
  }
  if (notSamePairs.has([e.from, e.to].sort().join("~~"))) {
    skipped.push(["merge:notSame", e]); continue;
  }
  addMerge(dataDir, e.from, e.to);
  applied.merges++;
}

for (const e of proposals.deletedEntities) {
  if (alreadyDeleted.has(e.key)) { skipped.push(["delete:already", e]); continue; }
  addDeletedEntity(dataDir, e.key);
  applied.deletedEntities++;
}

const totalApplied = applied.videoMerges + applied.merges + applied.deletedEntities;
if (totalApplied > 0) markGraphDirty(dataDir);

console.log(JSON.stringify({
  ms: Date.now() - t0, applied, skipped: skipped.length,
  graphMarkedDirty: totalApplied > 0,
}, null, 2));

if (skipped.length > 0 && process.argv.includes("--verbose")) {
  for (const s of skipped.slice(0, 20)) console.error("skip:", s[0], JSON.stringify(s[1]));
}
