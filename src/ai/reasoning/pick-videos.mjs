// Pick videos for a reasoning-layer test (Plan 3).
//
// Default: N random videos that already have data/claims/<id>.json written.
// Unlike ai/claims/pick-videos.mjs (which *excludes* videos with claim files),
// this script *requires* them — the reasoning layer consumes claims, it
// doesn't produce them. Operator can pin specific ids with --video.
//
// Writes _reasoning_tmp/picks.json so run.mjs / summary.mjs can read.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
const dataDir = "data";

function parseArgs(argv) {
  const args = { count: 2, videos: [], all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") {
      args.all = true;
    } else if (a === "--count" && argv[i + 1]) {
      args.count = Math.max(1, Number(argv[++i]) | 0);
    } else if (a === "--video" && argv[i + 1]) {
      args.videos.push(argv[++i]);
    } else if (a.startsWith("--video=")) {
      args.videos.push(a.slice("--video=".length));
    }
  }
  return args;
}

// Plan-3 aggregate reports live in data/claims/ alongside the per-video
// files. Filter them out — they're not video ids.
const DERIVED_FILES = new Set([
  "claims-index",
  "dependency-graph",
  "contradictions",
]);

function videoIdsWithFile(dir) {
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((id) => !DERIVED_FILES.has(id)),
  );
}

const args = parseArgs(process.argv.slice(2));

const claims = videoIdsWithFile(join(dataDir, "claims"));

let picks;
if (args.all) {
  picks = [...claims].sort();
} else if (args.videos.length > 0) {
  picks = args.videos.filter((id) => claims.has(id));
  const missing = args.videos.filter((id) => !claims.has(id));
  if (missing.length > 0) {
    console.error(
      `warning: ${missing.length} pinned video(s) skipped (no claim file): ${missing.join(", ")}`,
    );
  }
} else {
  const pool = [...claims].sort();
  picks = [];
  while (picks.length < args.count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
}

if (!existsSync("_reasoning_tmp")) mkdirSync("_reasoning_tmp");
const out = {
  pickedAt: new Date().toISOString(),
  videos: picks,
  eligibleCount: claims.size,
};
writeFileSync("_reasoning_tmp/picks.json", JSON.stringify(out, null, 2));

console.log(JSON.stringify({ ms: Date.now() - t0, ...out }, null, 2));
