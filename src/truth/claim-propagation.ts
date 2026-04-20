// Derived truthiness over the claim dependency DAG (Plan 3).
//
// Input: a flat list of Claim records (may span multiple videos). Dependencies
// are intra-file only — the claim validator enforces that every dep.target is
// an id within the same file. So the DAG is a disjoint union of per-video
// subgraphs; we still treat it as one graph because the algorithm doesn't
// care.
//
// Rules (from plans/03-reasoning-layer.md):
//   - A supports B   : B is pulled toward A (positive coupling)
//   - A contradicts B: B is pushed away from A (toward 1-A)
//   - A presupposes B: A is min-capped at B  (A cannot be truer than B)
//   - A elaborates B : no coupling
//
// Invariants:
//   - directTruth is an anchor, never overwritten.
//   - Claims with no anchor in their connected component end up without a
//     derivedTruth (we do not invent truth from nothing).
//   - Iterate to convergence (ε=0.001, max 50 iterations), same shape as the
//     relationship propagator in propagation.ts.

import type { Claim, ClaimId, DependencyKind } from "../claims/types.js";

export interface ClaimPropagationOptions {
  epsilon?: number;
  maxIterations?: number;
  // How much neighbor influence is weighted relative to the direct-truth anchor.
  neighborWeight?: number;
  // Pin these claims' directTruth to the supplied value for this run (used by
  // counterfactual analysis). Overrides the claim's own directTruth.
  pinned?: Map<ClaimId, number>;
}

export interface ClaimPropagationResult {
  iterations: number;
  maxDelta: number;
  derived: Map<ClaimId, number>;
}

interface InEdge {
  from: ClaimId;
  kind: DependencyKind;
}

function buildInEdges(claims: Claim[]): Map<ClaimId, InEdge[]> {
  const inEdges = new Map<ClaimId, InEdge[]>();
  for (const c of claims) {
    if (!c.dependencies) continue;
    for (const dep of c.dependencies) {
      const list = inEdges.get(dep.target) ?? [];
      list.push({ from: c.id, kind: dep.kind });
      inEdges.set(dep.target, list);
    }
  }
  return inEdges;
}

// "presupposes" edges of claim X: list of targets Y that X presupposes. X's
// derivedTruth is min-capped at derived(Y) for every such Y.
function buildPresupposes(claims: Claim[]): Map<ClaimId, ClaimId[]> {
  const out = new Map<ClaimId, ClaimId[]>();
  for (const c of claims) {
    if (!c.dependencies) continue;
    for (const dep of c.dependencies) {
      if (dep.kind !== "presupposes") continue;
      const list = out.get(c.id) ?? [];
      list.push(dep.target);
      out.set(c.id, list);
    }
  }
  return out;
}

export function propagateClaims(
  claims: Claim[],
  opts: ClaimPropagationOptions = {},
): ClaimPropagationResult {
  const epsilon = opts.epsilon ?? 0.001;
  const maxIter = opts.maxIterations ?? 50;
  const neighborWeight = opts.neighborWeight ?? 0.4;
  const pinned = opts.pinned ?? new Map<ClaimId, number>();

  const byId = new Map<ClaimId, Claim>();
  for (const c of claims) byId.set(c.id, c);

  const anchor = new Map<ClaimId, number>();
  const value = new Map<ClaimId, number | undefined>();
  for (const c of claims) {
    const pin = pinned.get(c.id);
    const a = pin !== undefined ? pin : c.directTruth;
    if (a !== undefined) anchor.set(c.id, a);
    value.set(c.id, a);
  }

  const inEdges = buildInEdges(claims);
  const presupposes = buildPresupposes(claims);

  let maxDelta = Infinity;
  let iterations = 0;
  while (iterations < maxIter && maxDelta > epsilon) {
    maxDelta = 0;
    iterations++;
    for (const c of claims) {
      const incoming = inEdges.get(c.id) ?? [];
      let weightSum = 0;
      let valueSum = 0;
      for (const edge of incoming) {
        if (edge.kind === "elaborates") continue;
        const from = byId.get(edge.from);
        const v = value.get(edge.from);
        if (!from || v === undefined) continue;
        const w = from.confidence;
        let contribution: number;
        if (edge.kind === "supports") {
          contribution = v;
        } else if (edge.kind === "contradicts") {
          contribution = 1 - v;
        } else {
          // presupposes: the target (this claim) doesn't get pulled by a
          // presupposition — presupposition is handled as a post-cap below
          // on the claim that issued the presupposes edge.
          continue;
        }
        weightSum += w;
        valueSum += w * contribution;
      }

      const a = anchor.get(c.id);
      let next: number | undefined;
      if (a !== undefined) {
        if (weightSum > 0) {
          const neighborAvg = valueSum / weightSum;
          next = a * (1 - neighborWeight) + neighborAvg * neighborWeight;
        } else {
          next = a;
        }
      } else if (weightSum > 0) {
        next = valueSum / weightSum;
      } else {
        next = undefined;
      }

      // Presupposes min-cap: claim is never truer than any of its presupposed
      // claims. Applied AFTER anchor+neighbor blend so the cap survives even
      // when the anchor is high.
      const preps = presupposes.get(c.id);
      if (preps && next !== undefined) {
        for (const targetId of preps) {
          const targetVal = value.get(targetId);
          if (targetVal !== undefined && targetVal < next) next = targetVal;
        }
      }

      if (next !== undefined) {
        const prev = value.get(c.id);
        const delta = prev === undefined ? Math.abs(next) : Math.abs(next - prev);
        if (delta > maxDelta) maxDelta = delta;
        value.set(c.id, next);
      }
    }
  }

  const derived = new Map<ClaimId, number>();
  for (const c of claims) {
    const v = value.get(c.id);
    if (v !== undefined) derived.set(c.id, clamp01(v));
  }
  return { iterations, maxDelta, derived };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Convenience: attach derivedTruth back onto the claim records in place.
// Returns the same array for chaining.
export function annotateDerivedTruth(
  claims: Claim[],
  derived: Map<ClaimId, number>,
): Array<Claim & { derivedTruth?: number }> {
  return claims.map((c) => {
    const v = derived.get(c.id);
    if (v === undefined) return c;
    return { ...c, derivedTruth: v };
  });
}
