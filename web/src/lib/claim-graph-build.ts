// Build the claim-graph neighborhood from a seed.
//
// Seed can be a video id, an entity key, or a single claim id. Walks:
//   - dependencies (outbound + inbound, 1 hop)
//   - contradictions (both sides)
//   - shared-evidence links (any other claim citing the same relationship id)
//
// Pure function — pass in the loaded index / dep-graph / contradictions
// and get back graph-shaped data for rendering.

import type {
  ClaimsIndexEntry,
  ClaimContradiction,
  DependencyGraphFile,
} from "../types";

export type ClaimGraphEdgeKind =
  | "supports"
  | "contradicts"
  | "presupposes"
  | "elaborates"
  | "shared-evidence"
  | "contradiction";

export interface ClaimGraphNode {
  id: string;
  claim: ClaimsIndexEntry;
  truth: number | null;
  distance: number;  // 0 = seed, 1 = neighbor
}

export interface ClaimGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: ClaimGraphEdgeKind;
  label?: string;
}

export interface ClaimGraphData {
  nodes: Map<string, ClaimGraphNode>;
  edges: Map<string, ClaimGraphEdge>;
}

// Merge the neighborhood produced by a second seed into an existing
// graph view. Nodes that already exist keep their smaller `distance`
// value (so the original seed stays flagged as distance 0). Edges are
// deduplicated by id. Used by the "add to graph" affordance on the
// claim-graph page so users can build up a multi-seed exploration
// without blowing away their drag/layout state.
export function mergeClaimGraph(base: ClaimGraphData, add: ClaimGraphData): ClaimGraphData {
  const nodes = new Map(base.nodes);
  for (const [id, n] of add.nodes) {
    const existing = nodes.get(id);
    if (!existing) {
      nodes.set(id, n);
    } else if (n.distance < existing.distance) {
      nodes.set(id, { ...existing, distance: n.distance });
    }
  }
  const edges = new Map(base.edges);
  for (const [id, e] of add.edges) {
    if (!edges.has(id)) edges.set(id, e);
  }
  return { nodes, edges };
}

export interface BuildInput {
  index: ClaimsIndexEntry[];
  deps: DependencyGraphFile;
  contradictions: ClaimContradiction[];
}

// Select the initial seed set of claim ids.
export function resolveSeed(
  input: BuildInput,
  seed: { kind: "video"; videoId: string } | { kind: "entity"; entityKey: string } | { kind: "claim"; claimId: string },
): string[] {
  if (seed.kind === "claim") return [seed.claimId];
  if (seed.kind === "video") {
    return input.index.filter((c) => c.videoId === seed.videoId).map((c) => c.id);
  }
  return input.index.filter((c) => c.entities.includes(seed.entityKey)).map((c) => c.id);
}

export function buildClaimGraph(
  input: BuildInput,
  seedClaimIds: string[],
): ClaimGraphData {
  const byId = new Map(input.index.map((c) => [c.id, c]));
  const nodes = new Map<string, ClaimGraphNode>();
  const edges = new Map<string, ClaimGraphEdge>();

  function truthOf(c: ClaimsIndexEntry): number | null {
    if (c.derivedTruth !== null && c.derivedTruth !== undefined) return c.derivedTruth;
    if (c.directTruth !== null && c.directTruth !== undefined) return c.directTruth;
    return null;
  }

  function addNode(id: string, distance: number) {
    if (nodes.has(id)) {
      const n = nodes.get(id)!;
      if (distance < n.distance) n.distance = distance;
      return;
    }
    const claim = byId.get(id);
    if (!claim) return;
    nodes.set(id, { id, claim, truth: truthOf(claim), distance });
  }

  function addEdge(from: string, to: string, kind: ClaimGraphEdgeKind, label?: string) {
    if (!nodes.has(from) || !nodes.has(to)) return;
    const key = `${from}->${to}:${kind}`;
    if (edges.has(key)) return;
    edges.set(key, { id: key, from, to, kind, label });
  }

  // Seed nodes at distance 0.
  for (const id of seedClaimIds) addNode(id, 0);

  // Precompute: claim id → {outDeps, inDeps}
  const outDeps = new Map<string, Array<{ to: string; kind: ClaimGraphEdgeKind }>>();
  const inDeps = new Map<string, Array<{ from: string; kind: ClaimGraphEdgeKind }>>();
  for (const e of input.deps.edges) {
    const o = outDeps.get(e.from) ?? [];
    o.push({ to: e.to, kind: e.kind as ClaimGraphEdgeKind });
    outDeps.set(e.from, o);
    const i = inDeps.get(e.to) ?? [];
    i.push({ from: e.from, kind: e.kind as ClaimGraphEdgeKind });
    inDeps.set(e.to, i);
  }

  // Shared-evidence index: relationship id → [claim ids]
  const byRel = new Map<string, string[]>();
  for (const c of input.index) {
    for (const r of c.relationships) {
      const list = byRel.get(r) ?? [];
      list.push(c.id);
      byRel.set(r, list);
    }
  }

  // Expand 1 hop from each seed.
  const seedSet = new Set(seedClaimIds);
  for (const id of seedSet) {
    for (const o of outDeps.get(id) ?? []) {
      addNode(o.to, 1);
      addEdge(id, o.to, o.kind);
    }
    for (const i of inDeps.get(id) ?? []) {
      addNode(i.from, 1);
      addEdge(i.from, id, i.kind);
    }
    // Contradictions.
    for (const cx of input.contradictions) {
      if (cx.left === id) {
        addNode(cx.right, 1);
        addEdge(cx.left, cx.right, "contradiction", cx.kind);
      } else if (cx.right === id) {
        addNode(cx.left, 1);
        addEdge(cx.left, cx.right, "contradiction", cx.kind);
      }
    }
    // Shared evidence.
    const seed = byId.get(id);
    if (!seed) continue;
    for (const relId of seed.relationships) {
      for (const other of byRel.get(relId) ?? []) {
        if (other === id) continue;
        addNode(other, 1);
        addEdge(id, other, "shared-evidence", relId);
      }
    }
  }

  return { nodes, edges };
}

export const EDGE_COLOR: Record<ClaimGraphEdgeKind, string> = {
  supports: "#43a047",
  contradicts: "#e53935",
  presupposes: "#1e88e5",
  elaborates: "#9e9e9e",
  "shared-evidence": "#8e24aa",
  contradiction: "#ef6c00",
};

export const EDGE_STYLE: Record<ClaimGraphEdgeKind, { dasharray?: string }> = {
  supports: {},
  contradicts: {},
  presupposes: { dasharray: "6 4" },
  elaborates: { dasharray: "2 4" },
  "shared-evidence": { dasharray: "2 3" },
  contradiction: {},
};
