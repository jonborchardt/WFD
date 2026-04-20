// Per-edge derived truth sourced from citing claims.
//
// Heuristic from Plan 5 § Phase 3 (quick/modular path): for each
// aggregated graph edge, average the `derivedTruth` of every claim that
// cites it via `claim.relationships[]`. Claims without a derivedTruth are
// ignored; edges with zero eligible citations drop out.
//
// Pure function — no I/O. Caller supplies the claims and the mapping
// from per-video relationship ids to aggregated graph edge ids (built
// with the same adapter that `indexes` uses, so aliases land the same
// way in both outputs).

import type { ClaimsIndexEntry } from "./claim-indexes.js";

export interface EdgeTruthEntry {
  edgeId: string;        // aggregated key: "<subjectId>|<predicate>|<objectId>"
  truth: number;         // 0..1
  claimCount: number;    // citing claims with a derivedTruth
  supportingClaimIds: string[];
}

export interface EdgeTruthFile {
  generatedAt: string;
  edgeCount: number;
  edges: Record<string, EdgeTruthEntry>;
}

export function computeEdgeTruth(
  claims: ClaimsIndexEntry[],
  perVideoEdgeToGraphEdge: Map<string, Map<string, string>>,
): EdgeTruthFile {
  // graphEdgeId → { sumTruth, count, ids }
  const agg = new Map<string, { sum: number; count: number; ids: Set<string> }>();
  for (const c of claims) {
    const truth = c.derivedTruth ?? c.directTruth;
    if (truth === null || truth === undefined) continue;
    const m = perVideoEdgeToGraphEdge.get(c.videoId);
    if (!m) continue;
    for (const relId of c.relationships) {
      const graphEdgeId = m.get(relId);
      if (!graphEdgeId) continue;
      const slot = agg.get(graphEdgeId) ?? { sum: 0, count: 0, ids: new Set<string>() };
      slot.sum += truth;
      slot.count += 1;
      slot.ids.add(c.id);
      agg.set(graphEdgeId, slot);
    }
  }

  const edges: Record<string, EdgeTruthEntry> = {};
  for (const [edgeId, v] of agg) {
    edges[edgeId] = {
      edgeId,
      truth: v.sum / v.count,
      claimCount: v.count,
      supportingClaimIds: [...v.ids].sort(),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    edgeCount: Object.keys(edges).length,
    edges,
  };
}
