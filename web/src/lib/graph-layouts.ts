// Graph layout algorithms used by the RelationshipsPage.
// Circular and radial are computed in pure JS; ELK handles stress and force.

import type { GraphNode, GraphEdge } from "../types";

export interface Position { x: number; y: number; }
export type Positions = Record<string, Position>;

// Layout config built from a runtime spacing value so the sidebar
// slider can push neighbors closer or farther apart.
export function elkLayoutConfig(algo: string, spacing: number): Record<string, string> | null {
  if (algo === "stress") {
    return {
      "elk.algorithm": "stress",
      "elk.spacing.nodeNode": String(spacing),
      "elk.stress.desiredEdgeLength": String(spacing * 2),
      "elk.separateConnectedComponents": "true",
      "elk.stress.iterationLimit": "400",
    };
  }
  if (algo === "force") {
    return {
      "elk.algorithm": "force",
      "elk.spacing.nodeNode": String(spacing),
      "elk.force.temperature": "0.01",
      "elk.force.iterations": "500",
      "elk.separateConnectedComponents": "true",
    };
  }
  return null; // circular/radial computed manually
}

export const ELK_NODE_HEIGHT = 36;
export const elkNodeWidth = (n: GraphNode) => Math.max(80, n.canonical.length * 8 + 32);

export function circularLayout(allNodes: GraphNode[], spacing = 200): Positions {
  const n = allNodes.length;
  const out: Positions = {};
  if (n === 0) return out;
  const maxW = Math.max(...allNodes.map((nd) => elkNodeWidth(nd)));
  const scale = spacing / 200;
  const radius = Math.max(200 * scale, (n * (maxW + 40 * scale)) / (2 * Math.PI));
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    out[allNodes[i].id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  return out;
}

// Radial: seeds at center, neighbors on concentric rings by BFS distance.
export function radialLayout(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  seeds: Set<string>,
  spacing = 200,
): Positions {
  const out: Positions = {};
  if (allNodes.length === 0) return out;
  const nodeIdSet = new Set(allNodes.map((n) => n.id));

  const adj = new Map<string, Set<string>>();
  for (const n of allNodes) adj.set(n.id, new Set());
  for (const e of allEdges) {
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue;
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const id of seeds) {
    if (nodeIdSet.has(id)) { level.set(id, 0); queue.push(id); }
  }
  if (queue.length === 0) {
    level.set(allNodes[0].id, 0);
    queue.push(allNodes[0].id);
  }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const curLevel = level.get(cur)!;
    for (const nb of adj.get(cur) || []) {
      if (!level.has(nb)) { level.set(nb, curLevel + 1); queue.push(nb); }
    }
  }
  for (const n of allNodes) if (!level.has(n.id)) level.set(n.id, 1);

  const rings = new Map<number, string[]>();
  for (const [id, lv] of level) {
    if (!rings.has(lv)) rings.set(lv, []);
    rings.get(lv)!.push(id);
  }

  const maxW = Math.max(...allNodes.map((nd) => elkNodeWidth(nd)));
  const scale = spacing / 200;
  const ringSpacing = maxW * 2.5 * scale + 80 * scale;
  for (const [lv, ids] of rings) {
    const radius = lv === 0 ? (ids.length === 1 ? 0 : 80 * scale) : lv * ringSpacing;
    for (let i = 0; i < ids.length; i++) {
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
      out[ids[i]] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    }
  }
  return out;
}
