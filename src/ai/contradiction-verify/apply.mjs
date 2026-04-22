// Plan 04 §D — collect verdicts from every
// _contradiction_verify_tmp/*.verdicts.json and write
// data/claims/contradiction-verdicts.json (the persistent cache). Also
// rewrites data/claims/contradictions.json so only verdicts that are
// LOGICAL-CONTRADICTION or DEBUNKS remain in the public view.
// SAME-CLAIM verdicts go to data/claims/consonance.json as cross-video
// agreements (side-benefit — pairs where two different videos assert
// the same thesis).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = "data";
const claimsDir = join(dataDir, "claims");
const tmpDir = "_contradiction_verify_tmp";
if (!existsSync(tmpDir)) {
  console.error("no _contradiction_verify_tmp dir");
  process.exit(1);
}

// --- merge all shard verdict files ---
const shardFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".verdicts.json"));
const byPair = new Map(); // "left|right" (sorted) -> verdict entry

// Keep any prior verdicts so re-runs append rather than overwrite.
const verdictsPath = join(claimsDir, "contradiction-verdicts.json");
if (existsSync(verdictsPath)) {
  try {
    const prev = JSON.parse(readFileSync(verdictsPath, "utf8"));
    for (const v of prev.verdicts ?? []) {
      const k = [v.left, v.right].sort().join("|");
      byPair.set(k, v);
    }
  } catch {
    /* ignore corrupt prior file */
  }
}

for (const f of shardFiles) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(join(tmpDir, f), "utf8"));
  } catch (e) {
    console.error(`skip bad shard ${f}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(payload.verdicts)) continue;
  for (const v of payload.verdicts) {
    if (!v.left || !v.right || !v.verdict) continue;
    const [lo, hi] = [v.left, v.right].sort();
    byPair.set(`${lo}|${hi}`, {
      left: lo,
      right: hi,
      verdict: v.verdict,
      reasoning: v.reasoning ?? null,
      by: v.by ?? "ai",
      at: v.at ?? new Date().toISOString(),
    });
  }
}

const verdicts = [...byPair.values()].sort((a, b) =>
  a.left.localeCompare(b.left) || a.right.localeCompare(b.right),
);

writeFileSync(
  verdictsPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      count: verdicts.length,
      byVerdict: verdicts.reduce((a, v) => {
        a[v.verdict] = (a[v.verdict] ?? 0) + 1;
        return a;
      }, {}),
      verdicts,
    },
    null,
    2,
  ),
);

// --- rewrite contradictions.json to only surface verified-real pairs ---
const contradictionsPath = join(claimsDir, "contradictions.json");
if (!existsSync(contradictionsPath)) {
  console.log(
    JSON.stringify({ ok: true, verdicts: verdicts.length, note: "no contradictions.json to rewrite" }, null, 2),
  );
  process.exit(0);
}

const c = JSON.parse(readFileSync(contradictionsPath, "utf8"));
const verdictByPair = new Map(verdicts.map((v) => [`${v.left}|${v.right}`, v]));

// Split into: kept contradictions, consonance, dropped
const kept = [];
const consonance = [];
const dropped = { total: 0, byVerdict: {} };

for (const x of c.contradictions ?? []) {
  const [lo, hi] = [x.left, x.right].sort();
  const v = verdictByPair.get(`${lo}|${hi}`);
  if (!v) {
    // No verdict yet — preserve with verified:null so re-verification
    // runs can pick it up.
    kept.push({ ...x, verified: null });
    continue;
  }
  x.verified = {
    verdict: v.verdict,
    reasoning: v.reasoning ?? undefined,
    by: v.by ?? "ai",
  };
  if (v.verdict === "LOGICAL-CONTRADICTION" || v.verdict === "DEBUNKS") {
    kept.push(x);
  } else if (v.verdict === "SAME-CLAIM") {
    consonance.push(x);
    dropped.total++;
    dropped.byVerdict[v.verdict] = (dropped.byVerdict[v.verdict] ?? 0) + 1;
  } else {
    // UNDERCUTS / ALTERNATIVE / COMPLEMENTARY / IRRELEVANT — drop
    dropped.total++;
    dropped.byVerdict[v.verdict] = (dropped.byVerdict[v.verdict] ?? 0) + 1;
  }
}

const byKindKept = kept.reduce((a, x) => {
  a[x.kind] = (a[x.kind] ?? 0) + 1;
  return a;
}, {});

writeFileSync(
  contradictionsPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: kept.length,
      byKind: byKindKept,
      verifiedDropped: dropped,
      contradictions: kept,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(claimsDir, "consonance.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      count: consonance.length,
      // Each entry is a cross-video agreement — same thesis, two different
      // videos. The UI can surface these as a positive "this claim appears
      // in N videos" signal instead of a contradiction.
      agreements: consonance,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      verdicts: verdicts.length,
      byVerdict: verdicts.reduce((a, v) => {
        a[v.verdict] = (a[v.verdict] ?? 0) + 1;
        return a;
      }, {}),
      kept: kept.length,
      dropped,
      consonance: consonance.length,
    },
    null,
    2,
  ),
);
