// Plan 04 §B driver — compute sentence embeddings for every claim in
// the corpus (or a slice) and cache them to data/claims/embeddings.json.
// No AI in the loop; pure code.
//
// Reads: data/claims/<id>.json (all, unless --video passed)
// Writes: data/claims/embeddings.json  (via embedding-bridge cache)
//
// CLI:
//   node src/ai/reasoning/embed-claims.mjs                        # all claim files
//   node src/ai/reasoning/embed-claims.mjs --video <id> [--video <id2>]
//   node src/ai/reasoning/embed-claims.mjs --model all-MiniLM-L6-v2
//   node src/ai/reasoning/embed-claims.mjs --dry                  # print what would be embedded
//
// Graceful degradation: if sentence-transformers isn't installed, the
// script prints the error and exits 1. Downstream code (the cross-
// video contradiction detector) still works without a cache — it just
// falls back to Jaccard. So this is a nice-to-have, not a hard
// dependency.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { embedWithCache } from "../../../dist/shared/embedding-bridge.js";

const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return args[i + 1];
}
function argAll(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[i + 1]);
  return out;
}
const explicitVideos = argAll("--video");
const modelId = arg("--model") ?? undefined;
const dry = args.includes("--dry");

const dataDir = "data";
const claimsDir = join(dataDir, "claims");
const cachePath = join(claimsDir, "embeddings.json");

if (!existsSync(claimsDir)) {
  console.error(`no claims dir at ${claimsDir}`);
  process.exit(1);
}

const RESERVED = new Set([
  "claims-index.json",
  "dependency-graph.json",
  "contradictions.json",
  "edge-truth.json",
  "embeddings.json",
]);

const claimFiles =
  explicitVideos.length > 0
    ? explicitVideos.map((v) => `${v}.json`)
    : readdirSync(claimsDir).filter(
        (f) => f.endsWith(".json") && !RESERVED.has(f),
      );

const batch = [];
for (const f of claimFiles) {
  const p = join(claimsDir, f);
  if (!existsSync(p)) { continue; }
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  if (!j || !Array.isArray(j.claims)) continue;
  for (const c of j.claims) {
    if (!c.id || typeof c.text !== "string") continue;
    batch.push({ id: c.id, text: c.text });
  }
}

if (batch.length === 0) {
  console.log(JSON.stringify({ ok: true, reason: "no claims found", files: claimFiles.length }, null, 2));
  process.exit(0);
}

if (dry) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dry: true,
        files: claimFiles.length,
        claims: batch.length,
        modelId: modelId ?? "all-MiniLM-L6-v2",
        cachePath,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const t0 = Date.now();
const result = await embedWithCache(cachePath, batch, { modelId });
const ms = Date.now() - t0;

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, error: result.error, ms }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ms,
      modelId: result.modelId,
      dimensions: result.dimensions,
      claims: batch.length,
      cacheHits: result.cacheHits,
      newlyEmbedded: result.newlyEmbedded,
      cachePath,
    },
    null,
    2,
  ),
);
