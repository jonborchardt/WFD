// Build ReactFlow nodes/edges from the current visible graph state.

import type { Node, Edge } from "reactflow";
import type { GraphNode, GraphEdge, EdgeTruthFile } from "../types";
import { elkNodeWidth, ELK_NODE_HEIGHT, type Positions } from "./graph-layouts";
import { colors, entityNodeColor } from "../theme";
import { truthColor } from "./truth-palette";

// Re-exported for legacy imports that referenced the per-type map
// directly. New code should call entityNodeColor(type).
export const ENTITY_TYPE_HEX = colors.entity;

export interface EdgeGradient {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  from: string; to: string;
}

export interface RenderResult {
  rfNodes: Node[];
  rfEdges: Edge[];
  gradients: EdgeGradient[];
}

export interface RenderOptions {
  // When provided, edges for which edge-truth has a derived truth are
  // colored by the truth palette instead of by entity-type gradient.
  colorByTruth?: boolean;
  edgeTruth?: EdgeTruthFile | null;
}

export function buildRenderData(
  nodeMap: Map<string, GraphNode>,
  edgeMap: Map<string, GraphEdge>,
  positions: Positions,
  seeds: Set<string>,
  selectedId: string | null,
  options: RenderOptions = {},
): RenderResult {
  const nodeIdSet = new Set(nodeMap.keys());
  const rfNodes: Node[] = [...nodeMap.values()].map((n) => {
    const p = positions[n.id] || { x: 0, y: 0 };
    const color = entityNodeColor(n.type);
    const isSeed = seeds.has(n.id);
    const selected = selectedId === n.id;
    return {
      id: n.id,
      position: { x: p.x, y: p.y },
      data: { label: n.canonical },
      style: {
        background: color,
        color: colors.surface.textOnColor,
        border: selected
          ? `3px solid ${colors.surface.text}`
          : isSeed
            ? `2px solid ${colors.surface.text}`
            : "1px solid rgba(0,0,0,0.3)",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: isSeed ? 13 : 11,
        fontWeight: isSeed ? 700 : 400,
        minWidth: 40,
      },
    };
  });

  // Merge edges: A→B and B→A with the same predicate collapse into one.
  const mergedEdges = new Map<string, GraphEdge>();
  for (const e of edgeMap.values()) {
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue;
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}|${e.predicate}|${hi}`;
    const existing = mergedEdges.get(key);
    if (existing) existing.count += e.count;
    else mergedEdges.set(key, { id: key, source: lo, target: hi, predicate: e.predicate, count: e.count });
  }

  const gradients: EdgeGradient[] = [];
  const rfEdges: Edge[] = [...mergedEdges.values()].map((e) => {
    const srcNode = nodeMap.get(e.source);
    const tgtNode = nodeMap.get(e.target);
    const srcColor = srcNode ? entityNodeColor(srcNode.type) : colors.surface.fallback;
    const tgtColor = tgtNode ? entityNodeColor(tgtNode.type) : colors.surface.fallback;
    const srcPos = positions[e.source] || { x: 0, y: 0 };
    const tgtPos = positions[e.target] || { x: 0, y: 0 };
    const sameColor = srcColor === tgtColor;
    const gradId = "eg-" + e.id.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80);
    if (!sameColor) {
      const sw = srcNode ? elkNodeWidth(srcNode) / 2 : 40;
      const tw = tgtNode ? elkNodeWidth(tgtNode) / 2 : 40;
      gradients.push({
        id: gradId,
        x1: srcPos.x + sw, y1: srcPos.y + ELK_NODE_HEIGHT / 2,
        x2: tgtPos.x + tw, y2: tgtPos.y + ELK_NODE_HEIGHT / 2,
        from: srcColor, to: tgtColor,
      });
    }
    // Optional truth overlay — color edges by avg derived truth of the
    // claims citing this edge. Looks up both directions because the
    // rendered edge is undirected (lo|predicate|hi) while edge-truth is
    // keyed on the original subject|predicate|object order.
    let truthStroke: string | null = null;
    if (options.colorByTruth && options.edgeTruth) {
      const aKey = `${e.source}|${e.predicate}|${e.target}`;
      const bKey = `${e.target}|${e.predicate}|${e.source}`;
      const a = options.edgeTruth.edges[aKey];
      const b = options.edgeTruth.edges[bKey];
      let t: number | null = null;
      if (a && b) t = (a.truth + b.truth) / 2;
      else if (a) t = a.truth;
      else if (b) t = b.truth;
      if (t !== null) truthStroke = truthColor(t);
    }

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      label: e.predicate,
      labelStyle: { fontSize: 10, fill: colors.surface.text },
      labelBgStyle: { fill: "rgba(30,30,30,0.85)" },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
      style: {
        stroke: truthStroke ?? (sameColor ? srcColor : `url(#${gradId})`),
        strokeWidth: Math.min(4, 1 + Math.log2(e.count + 1)),
        opacity: options.colorByTruth && !truthStroke ? 0.35 : 0.8,
      },
    };
  });

  return { rfNodes, rfEdges, gradients };
}
