import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ReactFlowInstance, Node as RfNode, Edge as RfEdge, NodeMouseHandler, EdgeMouseHandler,
} from "reactflow";
import type ELKCtor from "elkjs/lib/elk.bundled.js";

type ELKInstance = InstanceType<typeof ELKCtor>;
type ElkLayoutResult = Awaited<ReturnType<ELKInstance["layout"]>>;
import {
  Box, Paper, TextField, Typography, Chip, MenuItem, Button, CircularProgress,
} from "@mui/material";
import { fetchRelationshipsGraph } from "../lib/data";
import { graphNodeIssueUrl, graphEdgeIssueUrl } from "../lib/issues";
import {
  buildIndex, searchNodes, getNeighbors, getConnections, type GraphIndex,
} from "../lib/graph-index";
import {
  ELK_LAYOUT_CONFIGS, ELK_NODE_HEIGHT, elkNodeWidth,
  circularLayout, radialLayout, type Positions,
} from "../lib/graph-layouts";
import { buildRenderData, ENTITY_TYPE_HEX } from "../lib/graph-render";
import type { GraphNode, GraphEdge } from "../types";

// Union type for the dynamically-imported reactflow module
type ReactFlowLib = typeof import("reactflow");
type FlowState = { flow: ReactFlowLib; elk: ELKInstance };

export function RelationshipsPage() {
  const nav = useNavigate();
  const [graphIndex, setGraphIndex] = useState<GraphIndex | null>(null);
  const [flowLib, setFlowLib] = useState<FlowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GraphNode[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutAlgo, setLayoutAlgo] = useState("stress");
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const relayoutRef = useRef<() => void>(() => {});

  // Local graph state (grows incrementally)
  const nodeMap = useRef(new Map<string, GraphNode>());
  const edgeMap = useRef(new Map<string, GraphEdge>());
  const seeds = useRef(new Set<string>());
  const expanded = useRef(new Map<string, number>());
  const expandTotal = useRef(new Map<string, number>());
  const positions = useRef<Positions>({});
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    fetchRelationshipsGraph().then((data) => {
      if (data) setGraphIndex(buildIndex(data.nodes, data.edges));
      else setError("Failed to load graph data");
    });
  }, []);

  useEffect(() => {
    Promise.all([import("reactflow"), import("elkjs/lib/elk.bundled.js")])
      .then(([flow, elkMod]) => {
        const ELK = elkMod.default;
        setFlowLib({ flow, elk: new ELK() });
      })
      .catch((e) => setError(String(e)));
  }, []);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!query.trim() || !graphIndex) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSuggestions(searchNodes(graphIndex, query.trim(), 10));
    }, 200);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, graphIndex]);

  const fetchConnections = useCallback(() => {
    if (!graphIndex) return;
    const ids = new Set(nodeMap.current.keys());
    if (ids.size < 2) return;
    for (const e of getConnections(graphIndex, ids)) edgeMap.current.set(e.id, e);
  }, [graphIndex]);

  const addSeed = useCallback((node: GraphNode) => {
    if (!graphIndex) return;
    if (seeds.current.has(node.id)) return;
    seeds.current.add(node.id);
    nodeMap.current.set(node.id, node);
    const { neighbors, edges, total } = getNeighbors(graphIndex, node.id, 0, 20);
    for (const n of neighbors) nodeMap.current.set(n.id, n);
    for (const e of edges) edgeMap.current.set(e.id, e);
    expanded.current.set(node.id, neighbors.length);
    expandTotal.current.set(node.id, total);
    fetchConnections();
    relayoutRef.current();
  }, [graphIndex, fetchConnections]);

  const expandMore = useCallback((nodeId: string) => {
    if (!graphIndex) return;
    const offset = expanded.current.get(nodeId) || 0;
    const { neighbors, edges, total } = getNeighbors(graphIndex, nodeId, offset, 20);
    for (const n of neighbors) nodeMap.current.set(n.id, n);
    for (const e of edges) edgeMap.current.set(e.id, e);
    expanded.current.set(nodeId, offset + neighbors.length);
    expandTotal.current.set(nodeId, total);
    fetchConnections();
    relayoutRef.current();
  }, [graphIndex, fetchConnections]);

  const removeNode = useCallback((nodeId: string) => {
    seeds.current.delete(nodeId);
    expanded.current.delete(nodeId);
    expandTotal.current.delete(nodeId);
    nodeMap.current.delete(nodeId);
    delete positions.current[nodeId];
    for (const [eid, e] of edgeMap.current) {
      if (e.source === nodeId || e.target === nodeId) edgeMap.current.delete(eid);
    }
    const connectedIds = new Set<string>();
    for (const e of edgeMap.current.values()) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    for (const id of [...nodeMap.current.keys()]) {
      if (!seeds.current.has(id) && !connectedIds.has(id)) {
        nodeMap.current.delete(id);
        delete positions.current[id];
      }
    }
    bump();
  }, [bump]);

  const relayout = useCallback(() => {
    if (!flowLib) { bump(); return; }
    const { elk } = flowLib;
    const allNodes = [...nodeMap.current.values()];
    const allEdges = [...edgeMap.current.values()];
    if (allNodes.length === 0) { bump(); return; }

    if (layoutAlgo === "circular") {
      positions.current = { ...positions.current, ...circularLayout(allNodes) };
      bump();
      return;
    }
    if (layoutAlgo === "radial") {
      positions.current = { ...positions.current, ...radialLayout(allNodes, allEdges, seeds.current) };
      bump();
      return;
    }

    // ELK-backed layouts (stress, force)
    const nodeIdSet = new Set(allNodes.map((n) => n.id));
    const mergedForLayout = new Map<string, { id: string; source: string; target: string }>();
    for (const e of allEdges) {
      if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) continue;
      const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
      const key = `${lo}|${e.predicate}|${hi}`;
      if (!mergedForLayout.has(key)) {
        mergedForLayout.set(key, { id: key, source: e.source, target: e.target });
      }
    }
    const config = ELK_LAYOUT_CONFIGS[layoutAlgo] || ELK_LAYOUT_CONFIGS.stress;
    const sortedNodes = [...allNodes].sort((a, b) => {
      const aS = seeds.current.has(a.id) ? 0 : 1;
      const bS = seeds.current.has(b.id) ? 0 : 1;
      return aS - bS;
    });
    const elkGraph = {
      id: "root",
      layoutOptions: config ?? undefined,
      children: sortedNodes.map((n) => ({ id: n.id, width: elkNodeWidth(n), height: ELK_NODE_HEIGHT })),
      edges: [...mergedForLayout.values()].map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
    elk.layout(elkGraph).then((result: ElkLayoutResult) => {
      for (const n of result.children || []) {
        if (n.x !== undefined && n.y !== undefined && n.id) {
          positions.current[n.id] = { x: n.x, y: n.y };
        }
      }
      bump();
    }).catch(() => { bump(); });
  }, [flowLib, bump, layoutAlgo]);
  relayoutRef.current = relayout;

  useEffect(() => {
    if (flowLib && nodeMap.current.size > 0) {
      positions.current = {};
      relayout();
    }
  }, [layoutAlgo]);

  const prevNodeCount = useRef(0);
  useEffect(() => {
    const count = nodeMap.current.size;
    if (count > 0 && count !== prevNodeCount.current && rfInstance.current) {
      prevNodeCount.current = count;
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.3, duration: 300 }), 100);
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.3, duration: 300 }), 500);
    }
  }, [revision]);

  useEffect(() => {
    if (flowLib && nodeMap.current.size > 0) relayout();
  }, [flowLib, relayout]);

  const { rfNodes, rfEdges, gradients } = useMemo(
    () => buildRenderData(nodeMap.current, edgeMap.current, positions.current, seeds.current, selectedId),
    [revision, selectedId],
  );

  const focusNode = useCallback((id: string) => {
    const p = positions.current[id];
    if (!p || !rfInstance.current) return;
    rfInstance.current.setCenter(p.x, p.y, { zoom: 1.3, duration: 500 });
    setSelectedId(id);
  }, []);

  const clearAll = useCallback(() => {
    nodeMap.current.clear();
    edgeMap.current.clear();
    seeds.current.clear();
    expanded.current.clear();
    expandTotal.current.clear();
    positions.current = {};
    setSelectedId(null);
    setSelectedEdgeId(null);
    bump();
  }, [bump]);

  const onNodeDrag: NodeMouseHandler = (_, node) => {
    positions.current[node.id] = { x: node.position.x, y: node.position.y };
  };
  const onNodeDragStop: NodeMouseHandler = (_, node) => {
    positions.current[node.id] = { x: node.position.x, y: node.position.y };
    bump();
  };
  const onNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedId(node.id);
    setSelectedEdgeId(null);
  };
  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    nav("/entity/" + encodeURIComponent(node.id));
  };
  const onEdgeClick: EdgeMouseHandler = (_, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedId(null);
  };

  if (error) return <Box sx={{ p: 3 }}><Typography color="error">{error}</Typography></Box>;
  if (!graphIndex) return <Box sx={{ p: 3, textAlign: "center" }}><CircularProgress /></Box>;

  const hasNodes = rfNodes.length > 0;
  const selNode = selectedId ? nodeMap.current.get(selectedId) : null;
  const selEdge = selectedEdgeId ? edgeMap.current.get(selectedEdgeId) : null;
  const selExpanded = selectedId ? (expanded.current.get(selectedId) || 0) : 0;
  const selTotal = selectedId ? (expandTotal.current.get(selectedId) || 0) : 0;

  const ReactFlow = flowLib?.flow.default;
  const Background = flowLib?.flow.Background;
  const Controls = flowLib?.flow.Controls;
  const MiniMap = flowLib?.flow.MiniMap;

  return (
    <Box sx={{ position: "relative", height: "calc(100vh - 64px)", width: "100%" }}>
      <Paper sx={{ position: "absolute", top: 12, left: 12, zIndex: 10, p: 1.5, width: 340, maxHeight: "calc(100vh - 100px)", overflow: "auto" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="search entities to add to graph…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions[0]) {
              addSeed(suggestions[0]);
              setQuery("");
              setShowDropdown(false);
            } else if (e.key === "Escape") setShowDropdown(false);
          }}
        />
        {showDropdown && suggestions.length > 0 && (
          <Box sx={{ mt: 1, maxHeight: 250, overflow: "auto" }}>
            {suggestions.map((n) => (
              <Box
                key={n.id}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderRadius: 1 }}
                onClick={() => { addSeed(n); setQuery(""); setShowDropdown(false); }}
              >
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: ENTITY_TYPE_HEX[n.type] || "#888" }} />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>{n.canonical}</Typography>
                <Typography variant="caption" color="text.secondary">{n.type} · {n.weight}</Typography>
              </Box>
            ))}
          </Box>
        )}
        {seeds.current.size > 0 && (
          <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {[...seeds.current].map((id) => {
              const n = nodeMap.current.get(id);
              if (!n) return null;
              return (
                <Chip
                  key={id}
                  label={n.canonical}
                  size="small"
                  onDelete={() => removeNode(id)}
                  onClick={() => focusNode(id)}
                  sx={{ bgcolor: ENTITY_TYPE_HEX[n.type] || "#888", color: "#000", fontWeight: 600, "& .MuiChip-deleteIcon": { color: "rgba(0,0,0,0.5)" } }}
                />
              );
            })}
            <Chip label="clear all" size="small" variant="outlined" onClick={clearAll} sx={{ borderStyle: "dashed" }} />
          </Box>
        )}
        <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {Object.entries(ENTITY_TYPE_HEX).map(([t, c]) => (
            <Box key={t} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: c }} />
              <Typography variant="caption">{t}</Typography>
            </Box>
          ))}
        </Box>
        <TextField
          select
          size="small"
          label="layout"
          value={layoutAlgo}
          onChange={(e) => setLayoutAlgo(e.target.value)}
          sx={{ mt: 1.5, minWidth: 140 }}
        >
          <MenuItem value="stress">Stress (neato)</MenuItem>
          <MenuItem value="radial">Radial (twopi)</MenuItem>
          <MenuItem value="circular">Circular (circo)</MenuItem>
          <MenuItem value="force">Force</MenuItem>
        </TextField>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {rfNodes.length} nodes · {rfEdges.length} edges visible
        </Typography>
      </Paper>

      {!hasNodes && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 2, opacity: 0.6 }}>
          <Typography variant="h5">Search to explore the graph</Typography>
          <Typography variant="body2" color="text.secondary">
            Type an entity name in the search box to add it and its neighbors to the view.
          </Typography>
        </Box>
      )}

      {hasNodes && ReactFlow && Background && Controls && MiniMap && (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodesDraggable
          onInit={(inst) => { rfInstance.current = inst; inst.fitView({ padding: 0.3 }); }}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => { setShowDropdown(false); setSelectedId(null); setSelectedEdgeId(null); }}
          fitView
          minZoom={0.1}
          maxZoom={4}
        >
          <svg>
            <defs>
              {gradients.map((g) => (
                <linearGradient key={g.id} id={g.id} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
                  <stop offset="0%" stopColor={g.from} />
                  <stop offset="100%" stopColor={g.to} />
                </linearGradient>
              ))}
            </defs>
          </svg>
          <Background />
          <Controls />
          <MiniMap nodeColor={(n: RfNode) => (n.style?.background as string | undefined) || "#888"} pannable zoomable />
        </ReactFlow>
      )}

      {(selNode || selEdge) && (
        <Paper sx={{ position: "absolute", top: 12, right: 12, zIndex: 10, p: 1.5, width: 300, maxHeight: "calc(100vh - 100px)", overflow: "auto" }}>
          {selNode && (
            <>
              <Typography variant="subtitle2">{selNode.canonical}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{selNode.type} · weight {selNode.weight}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {selExpanded} of {selTotal} neighbors loaded
              </Typography>
              <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
                {selTotal > selExpanded && (
                  <Button size="small" variant="contained" onClick={() => expandMore(selNode.id)}>
                    load 20 more neighbors ({selTotal - selExpanded} remaining)
                  </Button>
                )}
                {!seeds.current.has(selNode.id) && (
                  <Button size="small" variant="contained" color="secondary" onClick={() => addSeed(selNode)}>
                    pin as seed
                  </Button>
                )}
                <Button size="small" variant="outlined" color="error" onClick={() => { removeNode(selNode.id); setSelectedId(null); }}>
                  remove from view
                </Button>
                <Button size="small" variant="outlined" onClick={() => nav("/entity/" + encodeURIComponent(selNode.id))}>
                  open entity page
                </Button>
                <Button size="small" variant="outlined" component="a" href={graphNodeIssueUrl(selNode)} target="_blank" rel="noopener">
                  create issue for this node
                </Button>
              </Box>
            </>
          )}
          {selEdge && (
            <>
              <Typography variant="subtitle2">
                {(nodeMap.current.get(selEdge.source) || { canonical: selEdge.source }).canonical}{" "}
                {selEdge.predicate}{" "}
                {(nodeMap.current.get(selEdge.target) || { canonical: selEdge.target }).canonical}
              </Typography>
              <Typography variant="caption" color="text.secondary">count {selEdge.count}</Typography>
              <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  component="a"
                  href={graphEdgeIssueUrl(selEdge, Object.fromEntries(nodeMap.current))}
                  target="_blank"
                  rel="noopener"
                >
                  create issue for this edge
                </Button>
              </Box>
            </>
          )}
        </Paper>
      )}
    </Box>
  );
}
