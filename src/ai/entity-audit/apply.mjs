// Apply all _entity_audit_tmp/*.proposals.json files atomically.
//
// Each agent writes a per-label proposals file with the shape:
//   {
//     label: "person",
//     generatedAt: "...",
//     proposals: [
//       { verdict: "DELETE-GLOBAL", key, reason },
//       { verdict: "MERGE-INTO",     from, to, rationale },
//       { verdict: "PER-VIDEO-MERGE", videoId, from, to, rationale },
//       { verdict: "KEEP",            key, rationale? },   // informational
//       { verdict: "DEFER",           key, reason? },      // informational
//     ]
//   }
//
// This apply script is idempotent: any entry already represented in
// aliases.json is skipped; any entry that conflicts with `notSame` is
// skipped; any target that doesn't exist in the corpus is skipped.
// Plan 2-1 §B4 (plans2/01-entity-hygiene.md).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDeletedEntity,
  addMerge,
  addVideoMerge,
  readAliasesFile,
} from "../../../dist/graph/aliases-schema.js";

const t0 = Date.now();
const dataDir = "data";
const tmpDir = "_entity_audit_tmp";

// ---- backup ----------------------------------------------------------
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const backupPath = join(tmpDir, "aliases.before.json");
if (!existsSync(backupPath)) {
  copyFileSync(join(dataDir, "aliases.json"), backupPath);
}

// ---- gather proposal files ------------------------------------------
const files = readdirSync(tmpDir).filter((f) => f.endsWith(".proposals.json"));
if (files.length === 0) {
  console.log(JSON.stringify({ ok: false, reason: "no proposal files found", tmpDir }, null, 2));
  process.exit(0);
}

// ---- corpus key set for validation ----------------------------------
const entDir = join(dataDir, "entities");
const entFiles = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
);
const corpusKeys = new Set();
function normalize(s) { return String(s).toLowerCase().trim().replace(/\s+/g, " "); }
for (const f of entFiles) {
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    corpusKeys.add(`${m.label}:${normalize(m.canonical)}`);
  }
}

// ---- current aliases state -----------------------------------------
const existing = readAliasesFile(dataDir);
const alreadyDeleted = new Set(existing.deletedEntities.map((e) => e.key));
const alreadyMergedFrom = new Set(existing.merges.map((e) => e.from));
const alreadyVideoMerged = new Set(
  existing.videoMerges.map((e) => `${e.videoId}::${e.from}`),
);
const notSamePairs = new Set(
  existing.notSame.map((e) => [e.a, e.b].sort().join("~~")),
);

// ---- apply ----------------------------------------------------------
const applied = { deleteGlobal: 0, merge: 0, perVideoMerge: 0 };
const skipped = [];

for (const file of files) {
  const payload = JSON.parse(readFileSync(join(tmpDir, file), "utf8"));
  if (!Array.isArray(payload.proposals)) continue;
  for (const p of payload.proposals) {
    try {
      if (p.verdict === "DELETE-GLOBAL") {
        if (!p.key) { skipped.push({ file, p, why: "missing key" }); continue; }
        if (!corpusKeys.has(p.key)) { skipped.push({ file, p, why: "not in corpus" }); continue; }
        if (alreadyDeleted.has(p.key)) { skipped.push({ file, p, why: "already deleted" }); continue; }
        addDeletedEntity(dataDir, p.key, p.reason);
        alreadyDeleted.add(p.key);
        applied.deleteGlobal++;
      } else if (p.verdict === "MERGE-INTO") {
        if (!p.from || !p.to) { skipped.push({ file, p, why: "missing from/to" }); continue; }
        if (p.from === p.to) { skipped.push({ file, p, why: "from === to" }); continue; }
        if (!corpusKeys.has(p.from) || !corpusKeys.has(p.to)) {
          skipped.push({ file, p, why: "endpoint not in corpus" });
          continue;
        }
        if (alreadyDeleted.has(p.from) || alreadyDeleted.has(p.to)) {
          skipped.push({ file, p, why: "endpoint already deleted" });
          continue;
        }
        if (alreadyMergedFrom.has(p.from)) {
          skipped.push({ file, p, why: "already merged" });
          continue;
        }
        const pair = [p.from, p.to].sort().join("~~");
        if (notSamePairs.has(pair)) {
          skipped.push({ file, p, why: "notSame asserted" });
          continue;
        }
        addMerge(dataDir, p.from, p.to, p.rationale);
        alreadyMergedFrom.add(p.from);
        applied.merge++;
      } else if (p.verdict === "PER-VIDEO-MERGE") {
        if (!p.videoId || !p.from || !p.to) { skipped.push({ file, p, why: "missing fields" }); continue; }
        if (p.from === p.to) { skipped.push({ file, p, why: "from === to" }); continue; }
        if (!corpusKeys.has(p.from) || !corpusKeys.has(p.to)) {
          skipped.push({ file, p, why: "endpoint not in corpus" });
          continue;
        }
        if (alreadyDeleted.has(p.from) || alreadyDeleted.has(p.to)) {
          skipped.push({ file, p, why: "endpoint already deleted" });
          continue;
        }
        const k = `${p.videoId}::${p.from}`;
        if (alreadyVideoMerged.has(k)) {
          skipped.push({ file, p, why: "already video-merged" });
          continue;
        }
        const pair = [p.from, p.to].sort().join("~~");
        if (notSamePairs.has(pair)) {
          skipped.push({ file, p, why: "notSame asserted" });
          continue;
        }
        addVideoMerge(dataDir, p.videoId, p.from, p.to);
        alreadyVideoMerged.add(k);
        applied.perVideoMerge++;
      } else if (p.verdict === "KEEP" || p.verdict === "DEFER") {
        // informational, no write
      } else {
        skipped.push({ file, p, why: `unknown verdict ${p.verdict}` });
      }
    } catch (e) {
      skipped.push({ file, p, why: "exception: " + (e.message ?? String(e)) });
    }
  }
}

// ---- bump graph.dirtyAt so the indexes stage re-runs ----------------
function markGraphDirty() {
  const p = join(dataDir, "catalog", "catalog.json");
  const c = JSON.parse(readFileSync(p, "utf8"));
  c.graph = c.graph ?? { stages: {} };
  c.graph.dirtyAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(c, null, 2), "utf8");
}
const totalApplied = applied.deleteGlobal + applied.merge + applied.perVideoMerge;
if (totalApplied > 0) markGraphDirty();

console.log(JSON.stringify({
  ms: Date.now() - t0,
  files: files.length,
  applied,
  skipped: skipped.length,
  graphMarkedDirty: totalApplied > 0,
}, null, 2));

if (skipped.length > 0 && process.argv.includes("--verbose")) {
  for (const s of skipped.slice(0, 50)) {
    console.error("skip:", s.why, JSON.stringify(s.p));
  }
}
