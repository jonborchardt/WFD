// Reasoning-layer driver (Plan 3).
//
// Reads the picks from _reasoning_tmp/picks.json, loads every
// data/claims/<id>.json for the picked videos, and runs:
//
//   1. claim propagation     (truth/claim-propagation)
//   2. claim contradictions   (truth/claim-contradictions)
//
// Writes three files to --out (default _reasoning_tmp/):
//
//   claims-index.json      flat list of claims with derivedTruth + propagation meta
//   dependency-graph.json  DAG edges (from, to, kind, rationale)
//   contradictions.json    pair + broken-presupposition + cross-video conflicts
//
// Per-phase timings print to stdout so the operator can see them live; they
// don't need a file of their own. Counterfactual queries are on-demand
// (plan §API additions), not a batch artifact — the module is imported by
// whoever needs it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { propagateClaims } from "../../../dist/truth/claim-propagation.js";
import { detectClaimContradictions } from "../../../dist/truth/claim-contradictions.js";

// Picks always live in the scratch dir; only the reports are redirectable.
const picksPath = "_reasoning_tmp/picks.json";
const dataDir = "data";
let outDir = "_reasoning_tmp";
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--out" && process.argv[i + 1]) outDir = process.argv[++i];
  else if (a.startsWith("--out=")) outDir = a.slice("--out=".length);
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
if (!existsSync(picksPath)) {
  console.error(`error: ${picksPath} missing — run pick-videos.mjs first`);
  process.exit(1);
}
const picks = JSON.parse(readFileSync(picksPath, "utf8"));

const phases = {};
const tAll = Date.now();

// --- Phase 1: load all claim files ------------------------------------
const tLoad = Date.now();
const allClaims = [];
for (const vid of picks.videos) {
  const p = join(dataDir, "claims", `${vid}.json`);
  if (!existsSync(p)) {
    console.error(`error: ${p} missing — pick another video or extract claims first`);
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(p, "utf8"));
  for (const c of payload.claims) allClaims.push(c);
}
phases.loadMs = Date.now() - tLoad;

// --- Phase 2: propagation ---------------------------------------------
const tProp = Date.now();
const propResult = propagateClaims(allClaims);
phases.propagationMs = Date.now() - tProp;

writeFileSync(
  `${outDir}/claims-index.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      videoCount: picks.videos.length,
      claimCount: allClaims.length,
      propagation: {
        iterations: propResult.iterations,
        maxDelta: propResult.maxDelta,
        claimsWithDerived: propResult.derived.size,
      },
      claims: allClaims.map((c) => ({
        id: c.id,
        videoId: c.videoId,
        kind: c.kind,
        text: c.text,
        hostStance: c.hostStance ?? null,
        entities: c.entities,
        dependencies: c.dependencies ?? [],
        confidence: c.confidence,
        directTruth: c.directTruth ?? null,
        derivedTruth: propResult.derived.get(c.id) ?? null,
      })),
    },
    null,
    2,
  ),
);

// --- Phase 3: dependency graph (flat edge list) -----------------------
const tDep = Date.now();
const depEdges = [];
for (const c of allClaims) {
  if (!c.dependencies) continue;
  for (const d of c.dependencies) {
    depEdges.push({ from: c.id, to: d.target, kind: d.kind, rationale: d.rationale ?? null });
  }
}
writeFileSync(
  `${outDir}/dependency-graph.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      edges: depEdges,
      edgeCount: depEdges.length,
    },
    null,
    2,
  ),
);
phases.dependencyGraphMs = Date.now() - tDep;

// --- Phase 4: contradictions ------------------------------------------
const tCon = Date.now();
const contradictions = detectClaimContradictions(allClaims);
phases.contradictionsMs = Date.now() - tCon;
const byKind = contradictions.reduce((acc, c) => {
  acc[c.kind] = (acc[c.kind] ?? 0) + 1;
  return acc;
}, {});
writeFileSync(
  `${outDir}/contradictions.json`,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: contradictions.length,
      byKind,
      contradictions,
    },
    null,
    2,
  ),
);

phases.totalMs = Date.now() - tAll;

console.log(
  JSON.stringify(
    {
      totalMs: phases.totalMs,
      perPhaseMs: phases,
      videos: picks.videos,
      totalClaims: allClaims.length,
      propagation: {
        iterations: propResult.iterations,
        maxDelta: propResult.maxDelta,
        claimsWithDerived: propResult.derived.size,
      },
      contradictions: { total: contradictions.length, byKind },
      outputs: [
        `${outDir}/claims-index.json`,
        `${outDir}/dependency-graph.json`,
        `${outDir}/contradictions.json`,
      ],
    },
    null,
    2,
  ),
);
