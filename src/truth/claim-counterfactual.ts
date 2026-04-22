// Counterfactual claim analysis (Plan 3).
//
// Given a claim id and a hypothetical directTruth value, re-run propagation
// with that claim pinned and return a delta report: which other claims
// move, by how much, in which direction.
//
// Cost is O(iterations × claim count) — same as one full propagation. On a
// 200-video corpus with ~10 claims each this is ~2000 claims × 50 iterations
// × constant work per claim ≈ sub-second. Cache results at indexes-stage
// time only if a UI surface makes this query hot.

import type { Claim, ClaimId } from "../claims/types.js";
import { propagateClaims } from "./claim-propagation.js";

export interface CounterfactualRow {
  claim: Claim;
  baselineTruth: number | undefined;
  counterfactualTruth: number;
  delta: number;
}

export interface CounterfactualResult {
  claimId: ClaimId;
  assumedTruth: number;
  baselineDerived: Map<ClaimId, number>;
  counterfactualDerived: Map<ClaimId, number>;
  rows: CounterfactualRow[];
}

export function counterfactual(
  claims: Claim[],
  claimId: ClaimId,
  assumedTruth: number,
): CounterfactualResult {
  const baseline = propagateClaims(claims);
  const pinned = new Map<ClaimId, number>();
  pinned.set(claimId, clamp01(assumedTruth));
  const cf = propagateClaims(claims, { pinned });

  const rows: CounterfactualRow[] = [];
  for (const c of claims) {
    const b = baseline.derived.get(c.id);
    const a = cf.derived.get(c.id);
    if (a === undefined) continue;
    const delta = a - (b ?? a);
    if (Math.abs(delta) < 0.0005) continue;
    rows.push({
      claim: c,
      baselineTruth: b,
      counterfactualTruth: a,
      delta,
    });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  return {
    claimId,
    assumedTruth,
    baselineDerived: baseline.derived,
    counterfactualDerived: cf.derived,
    rows,
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
