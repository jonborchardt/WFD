// Human-readable summary of a reasoning-layer run. Reads the three
// Plan-3 output files in --out and prints a concise report.

import { existsSync, readFileSync } from "node:fs";

let dir = "_reasoning_tmp";
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out" && process.argv[i + 1]) dir = process.argv[++i];
  else if (a.startsWith("--out=")) dir = a.slice("--out=".length);
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

const claimsIndex = readJson(`${dir}/claims-index.json`);
const contradictions = readJson(`${dir}/contradictions.json`);
const depGraph = readJson(`${dir}/dependency-graph.json`);

if (!claimsIndex) {
  console.error(`error: ${dir}/claims-index.json missing. Run:`);
  console.error("  node src/ai/reasoning/pick-videos.mjs --count 2");
  console.error(`  node src/ai/reasoning/run.mjs${dir !== "_reasoning_tmp" ? ` --out ${dir}` : ""}`);
  process.exit(1);
}

const perVideoClaimCounts = {};
const kindHist = {};
const stanceHist = {};
let withDirectTruth = 0;
let withDerivedTruth = 0;
const derivedMoves = [];  // |derivedTruth - directTruth| > 0.05 cases
for (const c of claimsIndex.claims) {
  perVideoClaimCounts[c.videoId] = (perVideoClaimCounts[c.videoId] ?? 0) + 1;
  kindHist[c.kind] = (kindHist[c.kind] ?? 0) + 1;
  const s = c.hostStance ?? "none";
  stanceHist[s] = (stanceHist[s] ?? 0) + 1;
  if (c.directTruth !== null) withDirectTruth++;
  if (c.derivedTruth !== null) withDerivedTruth++;
  if (
    c.directTruth !== null &&
    c.derivedTruth !== null &&
    Math.abs(c.derivedTruth - c.directTruth) > 0.05
  ) {
    derivedMoves.push({
      id: c.id,
      videoId: c.videoId,
      direct: c.directTruth,
      derived: c.derivedTruth,
      delta: c.derivedTruth - c.directTruth,
    });
  }
}
derivedMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

const report = {
  videoCount: claimsIndex.videoCount,
  totalClaims: claimsIndex.claimCount,
  perVideoClaimCounts,
  kindHistogram: kindHist,
  stanceHistogram: stanceHist,
  dependencies: depGraph ? { edgeCount: depGraph.edgeCount } : null,
  propagation: {
    iterations: claimsIndex.propagation?.iterations,
    maxDelta: claimsIndex.propagation?.maxDelta,
    claimsWithDirectTruth: withDirectTruth,
    claimsWithDerivedTruth: withDerivedTruth,
    topDerivedMoves: derivedMoves.slice(0, 5),
  },
  contradictions: {
    total: contradictions?.total ?? 0,
    byKind: contradictions?.byKind ?? {},
    samples: (contradictions?.contradictions ?? []).slice(0, 5).map((c) => ({
      kind: c.kind,
      left: c.left,
      right: c.right,
      summary: c.summary,
    })),
  },
};

console.log(JSON.stringify(report, null, 2));
