// Apply _entity_resolution_tmp/*.proposals.json per-video resolutions.
// Plan 2-2 §B4 (plans2/02-entity-resolution.md).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile, writeAliasesFile } from "../../../dist/graph/aliases-schema.js";

const t0 = Date.now();
const dataDir = "data";
const tmpDir = "_entity_resolution_tmp";

if (!existsSync(tmpDir)) { console.log("no tmp dir"); process.exit(0); }
const backupPath = join(tmpDir, "aliases.before.json");
if (!existsSync(backupPath)) copyFileSync(join(dataDir, "aliases.json"), backupPath);

const files = readdirSync(tmpDir).filter((f) => f.endsWith(".proposals.json"));
if (files.length === 0) { console.log(JSON.stringify({ ok: false, reason: "no proposal files" })); process.exit(0); }

const entDir = join(dataDir, "entities");
const entFiles = readdirSync(entDir).filter((f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"));
function normalize(s) { return String(s).toLowerCase().trim().replace(/\s+/g, " "); }
const corpusKeys = new Set();
for (const f of entFiles) {
  let j; try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !m.canonical) continue;
    corpusKeys.add(`${m.label}:${normalize(m.canonical)}`);
  }
}

const file = readAliasesFile(dataDir);
const alreadyDeleted = new Set(file.deletedEntities.map((e) => e.key));
const alreadyVideoMerged = new Set(file.videoMerges.map((e) => `${e.videoId}::${e.from}`));
const alreadyMergedFrom = new Set(file.merges.map((e) => e.from));
const notSamePairs = new Set(file.notSame.map((e) => [e.a, e.b].sort().join("~~")));

const applied = { perVideoMerge: 0, merge: 0 };
const skipped = [];

for (const fname of files) {
  const payload = JSON.parse(readFileSync(join(tmpDir, fname), "utf8"));
  if (!Array.isArray(payload.proposals)) continue;
  for (const p of payload.proposals) {
    try {
      if (p.verdict === "RESOLVE-PER-VIDEO") {
        // Part C writes per-proposal videoId; earlier batches wrote
        // file-level videoId. Prefer per-proposal when present.
        const videoId = p.videoId || payload.videoId;
        if (!videoId || videoId === "__part_c__" || !p.from || !p.to) { skipped.push({ fname, p, why: "missing fields" }); continue; }
        if (p.from === p.to) { skipped.push({ fname, p, why: "from === to" }); continue; }
        if (!corpusKeys.has(p.from) || !corpusKeys.has(p.to)) { skipped.push({ fname, p, why: "endpoint not in corpus" }); continue; }
        if (alreadyDeleted.has(p.from) || alreadyDeleted.has(p.to)) { skipped.push({ fname, p, why: "endpoint deleted" }); continue; }
        const k = `${videoId}::${p.from}`;
        if (alreadyVideoMerged.has(k)) { skipped.push({ fname, p, why: "already video-merged" }); continue; }
        const pair = [p.from, p.to].sort().join("~~");
        if (notSamePairs.has(pair)) { skipped.push({ fname, p, why: "notSame" }); continue; }
        file.videoMerges = file.videoMerges.filter((e) => !(e.videoId === videoId && e.from === p.from));
        file.videoMerges.push({ videoId, from: p.from, to: p.to });
        alreadyVideoMerged.add(k);
        applied.perVideoMerge++;
      } else if (p.verdict === "RESOLVE-CORPUS") {
        if (!p.from || !p.to) { skipped.push({ fname, p, why: "missing from/to" }); continue; }
        if (p.from === p.to) { skipped.push({ fname, p, why: "from === to" }); continue; }
        if (!corpusKeys.has(p.from) || !corpusKeys.has(p.to)) { skipped.push({ fname, p, why: "endpoint not in corpus" }); continue; }
        if (alreadyDeleted.has(p.from) || alreadyDeleted.has(p.to)) { skipped.push({ fname, p, why: "endpoint deleted" }); continue; }
        if (alreadyMergedFrom.has(p.from)) { skipped.push({ fname, p, why: "already merged" }); continue; }
        const pair = [p.from, p.to].sort().join("~~");
        if (notSamePairs.has(pair)) { skipped.push({ fname, p, why: "notSame" }); continue; }
        const entry = { from: p.from, to: p.to };
        if (p.rationale) entry.rationale = p.rationale;
        file.merges = file.merges.filter((e) => e.from !== p.from);
        file.merges.push(entry);
        alreadyMergedFrom.add(p.from);
        applied.merge++;
      } else if (p.verdict === "KEEP" || p.verdict === "DEFER") {
        // no-op
      } else {
        skipped.push({ fname, p, why: `unknown verdict ${p.verdict}` });
      }
    } catch (e) {
      skipped.push({ fname, p, why: "exception: " + (e.message ?? String(e)) });
    }
  }
}

const totalApplied = applied.perVideoMerge + applied.merge;
if (totalApplied > 0) {
  writeAliasesFile(dataDir, file);
  // bump graph.dirtyAt
  const p = join(dataDir, "catalog", "catalog.json");
  const c = JSON.parse(readFileSync(p, "utf8"));
  c.graph = c.graph ?? { stages: {} };
  c.graph.dirtyAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(c, null, 2), "utf8");
}

console.log(JSON.stringify({ ms: Date.now() - t0, files: files.length, applied, skipped: skipped.length }, null, 2));
if (skipped.length > 0 && process.argv.includes("--verbose")) {
  for (const s of skipped.slice(0, 30)) console.error("skip:", s.why, JSON.stringify(s.p));
}
