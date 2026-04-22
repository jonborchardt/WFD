// Plan 04 §D — prepare per-agent bundles of contradiction candidates for
// AI verification.
//
// Reads data/claims/contradictions.json + data/claims/claims-index.json,
// enriches each cross-video / pair candidate with the full claim text,
// evidence quotes, hostStance, rationale, shared entity names from both
// sides, and writes N shard files:
//   _contradiction_verify_tmp/slice-<i>.json   (a JSON array of candidate objects)
//
// Each candidate object is self-contained so the agent can verify it
// without reading the raw claim files.
//
// CLI:
//   node src/ai/contradiction-verify/prepare.mjs --agents 8
//   node src/ai/contradiction-verify/prepare.mjs --agents 4 --only cross-video
//   node src/ai/contradiction-verify/prepare.mjs --agents 8 --skip-verified
//     (skip pairs already verdicted in contradiction-verdicts.json)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i < 0 ? null : args[i + 1];
}
const agents = Math.max(1, Number(arg("--agents") ?? 8) | 0);
const onlyKind = arg("--only"); // "cross-video" | "pair" | null (all)
const skipVerified = args.includes("--skip-verified");

const dataDir = "data";
const outDir = "_contradiction_verify_tmp";
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// --- load ---
const contradictionsPath = join(dataDir, "claims", "contradictions.json");
if (!existsSync(contradictionsPath)) {
  console.error("missing data/claims/contradictions.json — run reasoning first");
  process.exit(1);
}
const all = JSON.parse(readFileSync(contradictionsPath, "utf8"));
const indexPath = join(dataDir, "claims", "claims-index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : null;
const claimsById = new Map();
if (index?.claims) for (const c of index.claims) claimsById.set(c.id, c);

// Hydrate full claim records with text + evidence + rationale from the
// per-video files. claims-index.json omits evidence to stay small.
function loadPerVideoClaim(claimId) {
  const colon = claimId.indexOf(":");
  if (colon < 0) return null;
  const vid = claimId.slice(0, colon);
  const p = join(dataDir, "claims", `${vid}.json`);
  if (!existsSync(p)) return null;
  try {
    const payload = JSON.parse(readFileSync(p, "utf8"));
    return (payload.claims || []).find((c) => c.id === claimId) ?? null;
  } catch {
    return null;
  }
}

// Optionally skip pairs that already have a verdict on disk.
const verdictsPath = join(dataDir, "claims", "contradiction-verdicts.json");
const existingVerdicts = new Set();
if (skipVerified && existsSync(verdictsPath)) {
  try {
    const v = JSON.parse(readFileSync(verdictsPath, "utf8"));
    for (const e of v.verdicts ?? []) {
      const pair = [e.left, e.right].sort().join("|");
      existingVerdicts.add(pair);
    }
  } catch {
    /* ignore */
  }
}

// Filter candidates into the verification queue. Verify:
//   - every cross-video pair (these need the most scrutiny)
//   - pair contradictions whose subkind is "logical" or "debunks"
//     (alternative/undercuts don't surface as contradictions anyway)
// Skip:
//   - broken-presupposition (mechanically sound; no AI verification needed)
//   - pairs already verdicted (if --skip-verified)
const items = [];
for (const c of all.contradictions ?? []) {
  if (c.kind === "broken-presupposition") continue;
  if (onlyKind && c.kind !== onlyKind) continue;
  const pair = [c.left, c.right].sort().join("|");
  if (existingVerdicts.has(pair)) continue;

  const left = loadPerVideoClaim(c.left);
  const right = loadPerVideoClaim(c.right);
  if (!left || !right) continue;

  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

  items.push({
    id: pair,
    kind: c.kind,
    subkind: c.subkind ?? null,
    matchReason: c.matchReason ?? null,
    similarity: c.similarity ?? null,
    sharedEntities: c.sharedEntities ?? [],
    left: {
      id: left.id,
      videoId: left.videoId,
      text: left.text,
      hostStance: left.hostStance ?? null,
      kind: left.kind,
      directTruth: left.directTruth ?? null,
      rationale: trunc(left.rationale, 400),
      evidenceQuote: (left.evidence?.[0]?.quote ?? "").slice(0, 300),
    },
    right: {
      id: right.id,
      videoId: right.videoId,
      text: right.text,
      hostStance: right.hostStance ?? null,
      kind: right.kind,
      directTruth: right.directTruth ?? null,
      rationale: trunc(right.rationale, 400),
      evidenceQuote: (right.evidence?.[0]?.quote ?? "").slice(0, 300),
    },
  });
}

// Shard
const slices = Array.from({ length: agents }, () => []);
items.forEach((it, i) => slices[i % agents].push(it));
for (let i = 0; i < agents; i++) {
  writeFileSync(
    join(outDir, `slice-${i}.json`),
    JSON.stringify(slices[i], null, 2),
    "utf8",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      agents,
      total: items.length,
      sliceSizes: slices.map((s) => s.length),
      onlyKind: onlyKind ?? "all",
      skipVerified,
    },
    null,
    2,
  ),
);
