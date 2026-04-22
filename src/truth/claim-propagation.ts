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
// Plan 04 (plans2/04-contradictions-v2.md) layers subkind semantics on top
// of `contradicts` — the subkind is parsed from the dep's rationale
// prefix (`[logical]` / `[debunks]` / `[alternative]` / `[undercuts]`).
//   - "logical" / "debunks"      : full contradicts coupling (contribution = 1-v)
//   - "alternative"              : halved negative coupling (competing explanations
//                                   pull less hard than strict contradictions)
//   - "undercuts"                : no negative pull; instead caps B's derived
//                                   truth at (1 - 0.2 * A.derivedTruth * A.confidence),
//                                   reducing the ceiling without flipping the sign
//
// Invariants:
//   - directTruth is an anchor, never overwritten.
//   - Claims with no anchor in their connected component end up without a
//     derivedTruth (we do not invent truth from nothing).
//   - Iterate to convergence (ε=0.001, max 50 iterations), same shape as the
//     relationship propagator in propagation.ts.

import type { Claim, ClaimId, DependencyKind } from "../claims/types.js";
import {
  parseContradictsSubkind,
  type ContradictsSubkind,
} from "./contradicts-subkind.js";

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
  // For kind === "contradicts", the parsed typed subkind (Plan 04).
  // Missing → treated as "logical" for back-compat with pre-v2 claim
  // files (matches the detector's default).
  contradictsSubkind?: ContradictsSubkind;
}

function buildInEdges(claims: Claim[]): Map<ClaimId, InEdge[]> {
  const inEdges = new Map<ClaimId, InEdge[]>();
  for (const c of claims) {
    if (!c.dependencies) continue;
    for (const dep of c.dependencies) {
      const list = inEdges.get(dep.target) ?? [];
      const edge: InEdge = { from: c.id, kind: dep.kind };
      if (dep.kind === "contradicts") {
        edge.contradictsSubkind =
          parseContradictsSubkind(dep.rationale) ?? "logical";
      }
      list.push(edge);
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

  // Plan 04: `undercuts` edges of claim B (i.e. incoming `contradicts`
  // edges with subkind "undercuts") cap B's derived truth at
  //   min_A ( 1 - 0.2 * A.derivedTruth * A.confidence )
  // applied as a post-cap after the anchor+neighbor blend, same shape
  // as the presupposes min-cap. Precomputed here to avoid re-scanning
  // edges each iteration.
  const undercuts = new Map<ClaimId, InEdge[]>();
  for (const [target, ins] of inEdges) {
    const u = ins.filter(
      (e) => e.kind === "contradicts" && e.contradictsSubkind === "undercuts",
    );
    if (u.length > 0) undercuts.set(target, u);
  }

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
        const baseW = from.confidence;
        let contribution: number;
        let w = baseW;
        if (edge.kind === "supports") {
          contribution = v;
        } else if (edge.kind === "contradicts") {
          // Plan 04: subkind governs the coupling strength.
          const sk = edge.contradictsSubkind ?? "logical";
          if (sk === "undercuts") {
            // Handled as a post-cap below; no iterative pull here.
            continue;
          }
          contribution = 1 - v;
          if (sk === "alternative") {
            // Competing-explanation pairs pull half as hard as strict
            // logical contradictions. Both can be partially true (each
            // explains some of the phenomenon) — don't hammer them to
            // opposite values.
            w = baseW * 0.5;
          }
          // "logical" / "debunks" / untyped fall through at full weight.
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

      // Plan 04 undercuts post-cap: every incoming `contradicts` edge
      // with subkind `undercuts` reduces this claim's ceiling by
      // 0.2 × source.derivedTruth × source.confidence. Multiple
      // undercutters stack by taking the tightest cap (per min-cap
      // semantics), same shape as the presupposes cap above.
      const undercutEdges = undercuts.get(c.id);
      if (undercutEdges && next !== undefined) {
        for (const edge of undercutEdges) {
          const from = byId.get(edge.from);
          const v = value.get(edge.from);
          if (!from || v === undefined) continue;
          const ceiling = 1 - 0.2 * v * from.confidence;
          if (ceiling < next) next = ceiling;
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
