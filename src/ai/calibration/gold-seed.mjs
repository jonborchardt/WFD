// Plan 05 §F3 — gold-sample seed.
//
// Picks ~20 videos from the corpus as reference gold (operator
// "manually verified as correct" slice) and copies their current
// per-video claim files into data/gold/claims/<id>.json. This
// freezes their state so future re-extractions can diff against
// what was known-good at seed time.
//
// Strategy: pick videos that are representative of the corpus:
//   - every kind covered at least once
//   - every host-stance covered at least once
//   - range of claim counts (short / medium / long)
//   - bias toward videos with verdicted contradictions (higher-signal)
//
// Idempotent: re-running overwrites existing gold files but leaves a
// summary on stdout. Operator can also hand-pick via --video flags.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function argAll(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[i + 1]);
  return out;
}
const pinned = argAll("--video");
const count = Number((() => {
  const i = args.indexOf("--count");
  return i < 0 ? 20 : args[i + 1];
})());

const dataDir = "data";
const claimsDir = join(dataDir, "claims");
const goldRoot = join(dataDir, "gold");
const goldClaimsDir = join(goldRoot, "claims");
if (!existsSync(goldClaimsDir)) mkdirSync(goldClaimsDir, { recursive: true });

const RESERVED = new Set([
  "claims-index.json",
  "dependency-graph.json",
  "contradictions.json",
  "edge-truth.json",
  "embeddings.json",
  "contradiction-verdicts.json",
  "consonance.json",
]);

const contradictionsByVideo = new Map();
try {
  const c = JSON.parse(readFileSync(join(claimsDir, "contradictions.json"), "utf8"));
  for (const x of c.contradictions ?? []) {
    for (const claimId of [x.left, x.right]) {
      const vid = claimId.split(":")[0];
      contradictionsByVideo.set(vid, (contradictionsByVideo.get(vid) ?? 0) + 1);
    }
  }
} catch {
  /* ignore */
}

const files = readdirSync(claimsDir).filter((f) => f.endsWith(".json") && !RESERVED.has(f));
const videos = [];
for (const f of files) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(claimsDir, f), "utf8")); } catch { continue; }
  if (!j || !Array.isArray(j.claims)) continue;
  const kinds = new Set();
  const stances = new Set();
  for (const c of j.claims) {
    if (c.kind) kinds.add(c.kind);
    if (c.hostStance) stances.add(c.hostStance);
  }
  videos.push({
    vid,
    claimCount: j.claims.length,
    kinds: [...kinds],
    stances: [...stances],
    contradictionCount: contradictionsByVideo.get(vid) ?? 0,
  });
}

// Pick algorithm: greedy coverage.
//   1. Take pinned ids first.
//   2. Iterate — at each step, pick the video that adds the most
//      uncovered (kind, stance, contradiction-bin) tuples, with ties
//      broken by contradictionCount desc then claimCount desc.
//   3. Stop at `count`.

function claimCountBin(n) {
  if (n <= 8) return "short";
  if (n <= 13) return "medium";
  return "long";
}

const covered = { kinds: new Set(), stances: new Set(), bins: new Set() };
const picked = new Set();
const order = [];

for (const p of pinned) {
  if (!videos.some((v) => v.vid === p)) continue;
  picked.add(p);
  order.push(p);
  const info = videos.find((v) => v.vid === p);
  for (const k of info.kinds) covered.kinds.add(k);
  for (const s of info.stances) covered.stances.add(s);
  covered.bins.add(claimCountBin(info.claimCount));
}

while (picked.size < count) {
  let best = null;
  let bestGain = -1;
  for (const v of videos) {
    if (picked.has(v.vid)) continue;
    let gain = 0;
    for (const k of v.kinds) if (!covered.kinds.has(k)) gain++;
    for (const s of v.stances) if (!covered.stances.has(s)) gain++;
    if (!covered.bins.has(claimCountBin(v.claimCount))) gain++;
    // tie-breaker: prefer high-contradiction videos
    const score = gain * 1000 + v.contradictionCount + v.claimCount / 100;
    if (score > bestGain) {
      bestGain = score;
      best = v;
    }
  }
  if (!best) break;
  picked.add(best.vid);
  order.push(best.vid);
  for (const k of best.kinds) covered.kinds.add(k);
  for (const s of best.stances) covered.stances.add(s);
  covered.bins.add(claimCountBin(best.claimCount));
}

// Copy the per-video claim files into data/gold/claims/.
const copied = [];
for (const vid of order) {
  const src = join(claimsDir, `${vid}.json`);
  const dst = join(goldClaimsDir, `${vid}.json`);
  writeFileSync(dst, readFileSync(src, "utf8"), "utf8");
  copied.push(vid);
}

// Write a manifest so gold-check.mjs knows which slice to diff.
writeFileSync(
  join(goldRoot, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      seededAt: new Date().toISOString(),
      count: copied.length,
      covered: {
        kinds: [...covered.kinds].sort(),
        stances: [...covered.stances].sort(),
        bins: [...covered.bins].sort(),
      },
      videos: copied,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      picked: copied.length,
      pinned: pinned.length,
      covered: {
        kinds: [...covered.kinds],
        stances: [...covered.stances],
        bins: [...covered.bins],
      },
      manifest: join(goldRoot, "manifest.json"),
    },
    null,
    2,
  ),
);
