// Derived truthiness propagation.
//
// Rule: derivedTruth of a relationship is a weighted average of its own
// directTruth (if any) and the derivedTruth of adjacent relationships that
// share an endpoint, weighted by their confidence. We iterate until the
// maximum per-edge delta falls below epsilon or we hit an iteration cap.
//
// Invariants:
//   - directTruth is never overwritten. It is an anchor.
//   - Edges without any anchor chain remain undefined (we do not invent
//     truth from nothing).

import { Relationship } from "../shared/types.js";
import { GraphStore } from "../graph/store.js";

export interface PropagationOptions {
  epsilon?: number;
  maxIterations?: number;
  // How much neighbor influence is weighted relative to the anchor.
  neighborWeight?: number;
}

export interface PropagationResult {
  iterations: number;
  maxDelta: number;
  updated: number;
}

interface EdgeState {
  rel: Relationship;
  anchor: number | undefined;
  value: number | undefined;
}

function buildAdjacency(rels: Relationship[]): Map<string, string[]> {
  const endpointToEdges = new Map<string, string[]>();
  for (const r of rels) {
    for (const ep of [r.subjectId, r.objectId]) {
      const list = endpointToEdges.get(ep) ?? [];
      list.push(r.id);
      endpointToEdges.set(ep, list);
    }
  }
  return endpointToEdges;
}

export function propagate(
  store: GraphStore,
  opts: PropagationOptions = {},
): PropagationResult {
  const epsilon = opts.epsilon ?? 0.001;
  const maxIter = opts.maxIterations ?? 50;
  const neighborWeight = opts.neighborWeight ?? 0.4;

  const rels = store.relationships();
  const byId = new Map<string, EdgeState>();
  for (const r of rels) {
    byId.set(r.id, {
      rel: r,
      anchor: r.directTruth,
      value: r.directTruth,
    });
  }
  const adjacency = buildAdjacency(rels);

  let maxDelta = Infinity;
  let iterations = 0;
  while (iterations < maxIter && maxDelta > epsilon) {
    maxDelta = 0;
    iterations++;
    for (const state of byId.values()) {
      const r = state.rel;
      const neighborIds = new Set<string>();
      for (const ep of [r.subjectId, r.objectId]) {
        for (const nid of adjacency.get(ep) ?? []) {
          if (nid !== r.id) neighborIds.add(nid);
        }
      }
      let weightSum = 0;
      let valueSum = 0;
      for (const nid of neighborIds) {
        const n = byId.get(nid)!;
        if (n.value === undefined) continue;
        const w = n.rel.confidence;
        weightSum += w;
        valueSum += w * n.value;
      }
      let next: number | undefined;
      if (state.anchor !== undefined) {
        if (weightSum > 0) {
          const neighborAvg = valueSum / weightSum;
          next = state.anchor * (1 - neighborWeight) + neighborAvg * neighborWeight;
        } else {
          next = state.anchor;
        }
      } else if (weightSum > 0) {
        next = valueSum / weightSum;
      }
      if (next !== undefined) {
        const prev = state.value ?? next;
        const delta = Math.abs(next - prev);
        if (delta > maxDelta) maxDelta = delta;
        state.value = next;
      }
    }
  }

  let updated = 0;
  for (const state of byId.values()) {
    if (state.value === undefined) continue;
    if (state.rel.derivedTruth !== state.value) {
      store.updateRelationship(state.rel.id, { derivedTruth: state.value });
      updated++;
    }
  }
  return { iterations, maxDelta, updated };
}

// Incremental entry point: re-run propagation whenever new evidence is
// attached. For now this is just propagate() — future versions can restrict
// the frontier to the connected component that changed.
export function propagateIncremental(
  store: GraphStore,
  _changedRelationshipIds: string[],
  opts: PropagationOptions = {},
): PropagationResult {
  return propagate(store, opts);
}
