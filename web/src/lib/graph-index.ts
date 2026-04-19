// Client-side graph queries over the prebuilt relationships-graph.json.
// Replaces the /api/graph/search|neighbors|connections routes the old server
// provided — same semantics, runs in-browser.

import type { GraphNode, GraphEdge } from "../types";
import { isVisibleType } from "./entity-visibility";

export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjEdges: Map<string, GraphEdge[]>;
}

export function buildIndex(nodes: GraphNode[], edges: GraphEdge[]): GraphIndex {
  const visible = nodes.filter((n) => isVisibleType(n.type));
  const nodeMap = new Map(visible.map((n) => [n.id, n]));
  const keptEdges = edges.filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target));
  const adj = new Map<string, GraphEdge[]>();
  for (const e of keptEdges) {
    let arr = adj.get(e.source);
    if (!arr) { arr = []; adj.set(e.source, arr); }
    arr.push(e);
    arr = adj.get(e.target);
    if (!arr) { arr = []; adj.set(e.target, arr); }
    arr.push(e);
  }
  return { nodes: nodeMap, edges: keptEdges, adjEdges: adj };
}

export function searchNodes(index: GraphIndex, q: string, limit: number): GraphNode[] {
  const needle = q.toLowerCase();
  const results: GraphNode[] = [];
  for (const n of index.nodes.values()) {
    if (n.canonical.toLowerCase().includes(needle)) results.push(n);
  }
  results.sort((a, b) => {
    const ai = a.canonical.toLowerCase().indexOf(needle);
    const bi = b.canonical.toLowerCase().indexOf(needle);
    if (ai !== bi) return ai - bi;
    return (b.weight || 0) - (a.weight || 0);
  });
  return results.slice(0, limit);
}

export interface NeighborsResult {
  neighbors: GraphNode[];
  edges: GraphEdge[];
  total: number;
}

export function getNeighbors(index: GraphIndex, nodeId: string, offset: number, limit: number): NeighborsResult {
  const edgesForNode = index.adjEdges.get(nodeId) || [];
  const neighborIds = new Set<string>();
  for (const e of edgesForNode) {
    const other = e.source === nodeId ? e.target : e.source;
    neighborIds.add(other);
  }
  const allNeighbors = [...neighborIds]
    .map((id) => index.nodes.get(id))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const sliced = allNeighbors.slice(offset, offset + limit);
  const slicedIds = new Set(sliced.map((n) => n.id));
  slicedIds.add(nodeId);
  const relevantEdges = edgesForNode.filter((e) => slicedIds.has(e.source) && slicedIds.has(e.target));
  return { neighbors: sliced, edges: relevantEdges, total: allNeighbors.length };
}

export function getConnections(index: GraphIndex, ids: Set<string>): GraphEdge[] {
  const result: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const e of index.adjEdges.get(id) || []) {
      if (seen.has(e.id)) continue;
      if (ids.has(e.source) && ids.has(e.target)) {
        result.push(e);
        seen.add(e.id);
      }
    }
  }
  return result;
}
