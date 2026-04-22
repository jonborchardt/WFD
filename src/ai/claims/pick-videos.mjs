// Pick videos for an AI claim-extraction session.
//
// Default: N random videos that have entities + relations but no
// data/claims/<id>.json yet. Operator can pin specific ids with --video.
// Writes _claims_tmp/picks.json so the skill can iterate.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
const dataDir = "data";

function parseArgs(argv) {
  const args = { count: 2, videos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count" && argv[i + 1]) {
      args.count = Math.max(1, Number(argv[++i]) | 0);
    } else if (a === "--video" && argv[i + 1]) {
      args.videos.push(argv[++i]);
    } else if (a.startsWith("--video=")) {
      args.videos.push(a.slice("--video=".length));
    }
  }
  return args;
}

function videoIdsWithFile(dir) {
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "")),
  );
}

const args = parseArgs(process.argv.slice(2));

const ents = videoIdsWithFile(join(dataDir, "entities"));
const rels = videoIdsWithFile(join(dataDir, "relations"));
const claims = videoIdsWithFile(join(dataDir, "claims"));

const eligible = [...ents]
  .filter((id) => rels.has(id) && !claims.has(id))
  .sort();

let picks;
if (args.videos.length > 0) {
  picks = args.videos.filter((id) => ents.has(id) && rels.has(id));
  const missing = args.videos.filter((id) => !ents.has(id) || !rels.has(id));
  if (missing.length > 0) {
    console.error(
      `warning: ${missing.length} pinned video(s) skipped (missing entities/relations): ${missing.join(", ")}`,
    );
  }
} else {
  // Random pick without replacement, deterministic-ish per Date for reproducibility within a session
  const pool = [...eligible];
  picks = [];
  while (picks.length < args.count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
}

if (!existsSync("_claims_tmp")) mkdirSync("_claims_tmp");
const out = {
  pickedAt: new Date().toISOString(),
  videos: picks,
  eligibleCount: eligible.length,
  totalEntitiesFiles: ents.size,
  totalRelationsFiles: rels.size,
  existingClaimsFiles: claims.size,
};
writeFileSync("_claims_tmp/picks.json", JSON.stringify(out, null, 2));

console.log(JSON.stringify({ ms: Date.now() - t0, ...out }, null, 2));
