import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Node as RfNode, Edge as RfEdge, ReactFlowInstance, NodeMouseHandler } from "reactflow";
import type ELKCtor from "elkjs/lib/elk.bundled.js";

type ELKInstance = InstanceType<typeof ELKCtor>;
import {
  Autocomplete,
  Box,
  Collapse,
  Paper,
  TextField,
  Typography,
  Chip,
  Button,
  Link as MuiLink,
  CircularProgress,
  Stack,
} from "@mui/material";
import {
  fetchCatalog,
  fetchClaimsIndex,
  fetchDependencyGraph,
  fetchContradictions,
  fetchEntityIndex,
} from "../lib/data";
import { beginLoad } from "../lib/loading";
import type { EntityIndexEntry, VideoRow } from "../types";
import {
  buildClaimGraph,
  mergeClaimGraph,
  resolveSeed,
  EDGE_COLOR,
  EDGE_STYLE,
  type ClaimGraphData,
  type ClaimGraphNode,
} from "../lib/claim-graph-build";
import { truthColor } from "../lib/truth-palette";
import { TruthBar } from "../components/TruthBar";
import type {
  ClaimsIndexEntry,
  ClaimContradiction,
  DependencyGraphFile,
} from "../types";

type ReactFlowLib = typeof import("reactflow");
type FlowState = { flow: ReactFlowLib; elk: ELKInstance };

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;

// Unified autocomplete option type. `id` is the seed value (entity key,
// video id, or claim id); `label` is what the user sees; `sub` is a
// secondary display line.
interface SeedOption {
  id: string;
  label: string;
  sub?: string;
}

// A seed that's been added to the current view, rendered as a removable
// pill. We keep the user-facing label on the record so pills don't have
// to re-query the (potentially large) autocomplete pool to rerender.
interface ActiveSeed {
  kind: "video" | "entity" | "claim";
  id: string;
  label: string;
}

export function ClaimGraphPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [index, setIndex] = useState<ClaimsIndexEntry[] | null>(null);
  const [deps, setDeps] = useState<DependencyGraphFile | null>(null);
  const [contradictions, setContradictions] = useState<ClaimContradiction[] | null>(null);
  const [flowLib, setFlowLib] = useState<FlowState | null>(null);
  const [data, setData] = useState<ClaimGraphData | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  // Default seed: the "Marfa Lights basketball-sized hovering orbs"
  // claim — it has rich dependencies (competing explanations, debunks
  // of the origin myth) so the graph lands non-empty on a fresh visit.
  // Any `?kind=…&q=…` in the URL wins over this default.
  const DEFAULT_SEED_KIND = "claim" as const;
  const DEFAULT_SEED_QUERY = "-HxKHUEwnug:c_0003";
  const [query, setQuery] = useState(params.get("q") ?? DEFAULT_SEED_QUERY);
  const [seedKind, setSeedKind] = useState<"video" | "entity" | "claim">(
    (params.get("kind") as "video" | "entity" | "claim") ?? DEFAULT_SEED_KIND,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSeeds, setActiveSeeds] = useState<ActiveSeed[]>([]);
  const [showLegend, setShowLegend] = useState(false);
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // Option pools for autocomplete. Each is loaded once.
  const [catalog, setCatalog] = useState<VideoRow[]>([]);
  const [entityPool, setEntityPool] = useState<EntityIndexEntry[]>([]);

  useEffect(() => {
    const endLoad = beginLoad();
    Promise.allSettled([
      fetchClaimsIndex().then((idx) => setIndex(idx?.claims ?? [])),
      fetchDependencyGraph().then(setDeps),
      fetchContradictions().then((c) => setContradictions(c?.contradictions ?? [])),
      fetchCatalog().then(setCatalog),
      fetchEntityIndex().then(setEntityPool),
    ]).finally(endLoad);
  }, []);

  // Build the autocomplete option list for the current seedKind. For
  // entities + videos we use the dedicated indexes. For claims, we draw
  // from claims-index; 2300+ rows is fine for Autocomplete (it filters
  // lazily). Sorted so most popular / most-recent results surface first.
  const options: SeedOption[] = useMemo(() => {
    if (seedKind === "entity") {
      return entityPool
        .slice()
        .sort((a, b) => b.mentionCount - a.mentionCount)
        .map((e) => ({
          id: e.id,
          label: e.canonical,
          sub: `${e.type} · ${e.videoCount} videos · ${e.mentionCount} mentions`,
        }));
    }
    if (seedKind === "video") {
      return catalog
        .slice()
        .sort((a, b) => (b.publishDate ?? b.uploadDate ?? "").localeCompare(a.publishDate ?? a.uploadDate ?? ""))
        .map((r) => ({
          id: r.videoId,
          label: r.title ?? r.videoId,
          sub: `${r.videoId}${r.channel ? " · " + r.channel : ""}`,
        }));
    }
    // claim
    return (index ?? []).map((c) => ({
      id: c.id,
      label: c.text,
      sub: `${c.videoId} · ${c.kind}`,
    }));
  }, [seedKind, entityPool, catalog, index]);

  const currentOption: SeedOption | null = useMemo(
    () => options.find((o) => o.id === query) ?? null,
    [options, query],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rf, elkMod] = await Promise.all([
        import("reactflow"),
        import("elkjs/lib/elk.bundled.js"),
      ]);
      await import("reactflow/dist/style.css");
      if (cancelled) return;
      setFlowLib({ flow: rf, elk: new elkMod.default() });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = index !== null && deps !== null && contradictions !== null && flowLib !== null;

  // Turn an ActiveSeed record back into the shape resolveSeed expects.
  function toSeedArg(s: ActiveSeed) {
    if (s.kind === "video") return { kind: "video" as const, videoId: s.id };
    if (s.kind === "claim") return { kind: "claim" as const, claimId: s.id };
    return { kind: "entity" as const, entityKey: s.id };
  }

  // Build a fresh graph from a list of seeds. Used both for "add" (after
  // appending the new seed to the list) and "remove" (after filtering
  // one out). Positions are left alone so user drags are preserved; the
  // layout effect will place any new nodes relative to existing ones.
  const rebuildFromSeeds = useCallback((seeds: ActiveSeed[]) => {
    if (!ready) return;
    if (seeds.length === 0) {
      setData({ nodes: new Map(), edges: new Map() });
      setPositions({});
      setSelectedId(null);
      return;
    }
    let merged: ClaimGraphData = { nodes: new Map(), edges: new Map() };
    for (const s of seeds) {
      const seedIds = resolveSeed(
        { index: index!, deps: deps!, contradictions: contradictions! },
        toSeedArg(s),
      );
      if (seedIds.length === 0) continue;
      const g = buildClaimGraph(
        { index: index!, deps: deps!, contradictions: contradictions! },
        seedIds,
      );
      merged = mergeClaimGraph(merged, g);
    }
    setData(merged);
  }, [ready, index, deps, contradictions]);

  // Load a seed's neighborhood. `mode === "replace"` wipes the current
  // view; `mode === "add"` appends to it so a user can build up a
  // multi-seed graph without losing drag positions.
  const runLoad = useCallback((mode: "replace" | "add") => {
    if (!ready || !currentOption) return;
    const next: ActiveSeed = {
      kind: seedKind,
      id: currentOption.id,
      label: currentOption.label,
    };
    if (mode === "replace") {
      setPositions({});
      setSelectedId(null);
      setActiveSeeds([next]);
      rebuildFromSeeds([next]);
      setParams({ kind: seedKind, q: query });
    } else {
      // Don't double-add the same seed.
      if (activeSeeds.some((s) => s.kind === next.kind && s.id === next.id)) return;
      const nextSeeds = [...activeSeeds, next];
      setActiveSeeds(nextSeeds);
      rebuildFromSeeds(nextSeeds);
    }
    // Reset the search field so the user can immediately start typing
    // the next seed they want to add without manually clearing.
    setQuery("");
  }, [ready, seedKind, query, currentOption, activeSeeds, rebuildFromSeeds, setParams]);

  const runSearch = useCallback(() => runLoad("replace"), [runLoad]);
  const runAdd = useCallback(() => runLoad("add"), [runLoad]);

  const removeSeed = useCallback((kind: ActiveSeed["kind"], id: string) => {
    const nextSeeds = activeSeeds.filter((s) => !(s.kind === kind && s.id === id));
    setActiveSeeds(nextSeeds);
    // Drop positions of nodes that no longer exist so the layout pass
    // doesn't treat them as pre-placed.
    setSelectedId(null);
    rebuildFromSeeds(nextSeeds);
  }, [activeSeeds, rebuildFromSeeds]);

  const clearAll = useCallback(() => {
    setActiveSeeds([]);
    rebuildFromSeeds([]);
  }, [rebuildFromSeeds]);

  // Multi-seed URL entry point. When the faceted claims / contradictions
  // pages ship a filtered list to the graph, they pass
  // `?kind=<k>&seeds=<id1>,<id2>,…`. Parse that once on mount, hydrate
  // activeSeeds, rebuild, and swallow the default single-seed auto-run
  // (`&q=`) so we don't double-build.
  const multiSeedRanRef = useRef(false);
  useEffect(() => {
    if (!ready || multiSeedRanRef.current) return;
    const raw = params.get("seeds");
    if (!raw) return;
    multiSeedRanRef.current = true;
    const kind = (params.get("kind") as ActiveSeed["kind"]) ?? "claim";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    // Resolve a display label from the option pool where available so
    // the pills show human-readable text, not raw ids.
    const optById = new Map(options.map((o) => [o.id, o]));
    const seeds: ActiveSeed[] = ids.map((id) => {
      const opt = optById.get(id);
      return { kind, id, label: opt?.label ?? id };
    });
    setActiveSeeds(seeds);
    rebuildFromSeeds(seeds);
    setQuery("");
  }, [ready, params, options, rebuildFromSeeds]);

  // Auto-run on initial load if query present (single-seed path).
  // Skipped when the multi-seed effect above fired.
  useEffect(() => {
    if (multiSeedRanRef.current) return;
    if (ready && query && !data) runSearch();
  }, [ready, query, data, runSearch]);

  // Layout whenever new nodes appear. Preserves previously-positioned
  // nodes so dragging isn't lost and re-seeding doesn't jitter nodes that
  // were already on screen. Only newly-added nodes get ELK-assigned.
  useEffect(() => {
    if (!data || !flowLib) return;
    if (data.nodes.size === 0) {
      setPositions({});
      return;
    }
    // Identify which nodes still need a position.
    const missing = [...data.nodes.keys()].filter((id) => !(id in positions));
    if (missing.length === 0) return;

    const nodes = [...data.nodes.keys()].map((id) => ({
      id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ...(positions[id]
        ? {
            // Pre-place existing nodes so ELK preserves them.
            x: positions[id].x,
            y: positions[id].y,
          }
        : {}),
    }));
    const edges = [...data.edges.values()].map((e) => ({
      id: e.id,
      sources: [e.from],
      targets: [e.to],
    }));
    const graph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "force",
        "elk.spacing.nodeNode": "80",
        // Hint ELK to respect pre-placed coordinates where available.
        "elk.force.iterations": String(missing.length === data.nodes.size ? 300 : 100),
      },
      children: nodes,
      edges,
    };
    flowLib.elk
      .layout(graph)
      .then((result: Awaited<ReturnType<ELKInstance["layout"]>>) => {
        const next = { ...positions };
        for (const c of result.children ?? []) {
          if (c.id && c.x !== undefined && c.y !== undefined) {
            // Only overwrite if we were asking for a new layout of
            // missing nodes; keep user-dragged positions stable.
            if (!(c.id in positions)) next[c.id] = { x: c.x, y: c.y };
          }
        }
        setPositions(next);
        // Zoom to fit whenever new nodes land on the canvas (initial
        // load or + add). Delay one frame so ReactFlow picks up the
        // new positions before we measure.
        setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 400 }), 60);
      });
    // positions is intentionally excluded — we only re-run on data/flowLib
    // changes. User drags call setPositions directly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, flowLib]);

  const onNodeDragStop: NodeMouseHandler = (_, node) => {
    setPositions((p) => ({ ...p, [node.id]: { x: node.position.x, y: node.position.y } }));
  };

  const rfData = useMemo(() => {
    if (!data) return { nodes: [] as RfNode[], edges: [] as RfEdge[] };
    const rfNodes: RfNode[] = [...data.nodes.values()].map((n) => {
      const pos = positions[n.id] ?? { x: 0, y: 0 };
      const color = n.truth !== null ? truthColor(n.truth) : "#bdbdbd";
      const selected = selectedId === n.id;
      const seed = n.distance === 0;
      return {
        id: n.id,
        position: { x: pos.x, y: pos.y },
        data: { label: truncate(n.claim.text, 80) },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          background: color,
          color: textColor(n.truth),
          border: selected ? "3px solid #000" : seed ? "2px solid #000" : "1px solid rgba(0,0,0,0.3)",
          borderRadius: 6,
          padding: 6,
          fontSize: 11,
          fontWeight: seed ? 600 : 400,
        },
      };
    });
    const rfEdges: RfEdge[] = [...data.edges.values()].map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      label: e.kind === "shared-evidence" ? "evidence" : e.kind,
      labelStyle: { fontSize: 10, fill: "#333" },
      labelBgStyle: { fill: "rgba(255,255,255,0.85)" },
      style: {
        stroke: EDGE_COLOR[e.kind],
        strokeWidth: e.kind === "contradicts" || e.kind === "contradiction" ? 2 : 1.5,
        strokeDasharray: EDGE_STYLE[e.kind].dasharray,
        opacity: 0.8,
      },
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [data, positions, selectedId]);

  const sel: ClaimGraphNode | null = selectedId && data ? data.nodes.get(selectedId) ?? null : null;

  if (!ready) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const ReactFlow = flowLib!.flow.default;
  const Background = flowLib!.flow.Background;
  const Controls = flowLib!.flow.Controls;
  const MiniMap = flowLib!.flow.MiniMap;

  return (
    <Box sx={{ position: "relative", height: "calc(100vh - 64px)", width: "100%" }}>
      <Paper sx={{ position: "absolute", top: 12, left: 12, zIndex: 10, p: 1.5, width: 340, maxHeight: "calc(100vh - 100px)", overflow: "auto" }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Claim graph</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          {(["entity", "video", "claim"] as const).map((k) => (
            <Chip
              key={k}
              size="small"
              label={k}
              color={seedKind === k ? "primary" : "default"}
              onClick={() => { setSeedKind(k); setQuery(""); }}
              clickable
            />
          ))}
        </Stack>
        <Autocomplete
          size="small"
          fullWidth
          options={options}
          value={currentOption}
          onChange={(_, v) => setQuery(v ? v.id : "")}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          // Limit to 50 visible matches so typing through 2k+ claims
          // doesn't drop frames.
          filterOptions={(opts, state) => {
            const q = state.inputValue.trim().toLowerCase();
            if (!q) return opts.slice(0, 50);
            const matches = opts.filter(
              (o) =>
                o.label.toLowerCase().includes(q) ||
                o.id.toLowerCase().includes(q) ||
                (o.sub ?? "").toLowerCase().includes(q),
            );
            return matches.slice(0, 50);
          }}
          renderOption={(props, o) => (
            <li {...props} key={o.id}>
              <Box>
                <Typography variant="body2">
                  {o.label.length > 80 ? o.label.slice(0, 80) + "…" : o.label}
                </Typography>
                {o.sub && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {o.sub}
                  </Typography>
                )}
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={
                seedKind === "entity"
                  ? "search entities…"
                  : seedKind === "video"
                    ? "search videos…"
                    : "search claims…"
              }
              onKeyDown={(e) => { if (e.key === "Enter" && currentOption) runSearch(); }}
            />
          )}
        />
        {/* Only render replace / + add once the user has actually
            selected an option in the autocomplete — otherwise the
            buttons are dead targets that only show a disabled tooltip.
            `clear` is still useful on its own once there are seeds. */}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {currentOption && (
            <Button
              size="small"
              variant="contained"
              onClick={runSearch}
            >
              {activeSeeds.length > 0 ? "replace" : "load"}
            </Button>
          )}
          {currentOption && activeSeeds.length > 0 && (
            <Button
              size="small"
              variant="outlined"
              disabled={activeSeeds.some((s) => s.kind === seedKind && s.id === currentOption.id)}
              onClick={runAdd}
              title="merge this seed's neighborhood into the existing graph"
            >
              + add
            </Button>
          )}
          {activeSeeds.length > 0 && (
            <Button size="small" variant="text" onClick={clearAll}>
              clear
            </Button>
          )}
        </Stack>

        {activeSeeds.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              active seeds ({activeSeeds.length}):
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {activeSeeds.map((s) => (
                <Chip
                  key={`${s.kind}:${s.id}`}
                  size="small"
                  variant="outlined"
                  label={
                    <span>
                      <span style={{ opacity: 0.6 }}>{s.kind}:</span>{" "}
                      {s.label.length > 40 ? s.label.slice(0, 40) + "…" : s.label}
                    </span>
                  }
                  onDelete={() => removeSeed(s.kind, s.id)}
                  title={`${s.kind} · ${s.id}`}
                />
              ))}
            </Box>
          </Box>
        )}

        {data && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {data.nodes.size} claims · {data.edges.size} edges
          </Typography>
        )}

        <Box sx={{ mt: 2, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
          <Box
            onClick={() => setShowLegend((v) => !v)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
              userSelect: "none",
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {showLegend ? "▾" : "▸"} legend
            </Typography>
          </Box>
          <Collapse in={showLegend}>
            <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mt: 0.5 }}>edges</Typography>
            <Stack sx={{ mt: 0.25 }} spacing={0.25}>
              {Object.entries(EDGE_COLOR).map(([k, c]) => (
                <Box key={k} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 16, height: 2, backgroundColor: c }} />
                  <Typography variant="caption">{k}</Typography>
                </Box>
              ))}
            </Stack>
            <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mt: 1 }}>node color = truth</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
              <Box sx={{ width: 16, height: 10, background: truthColor(0) }} />
              <Typography variant="caption">false</Typography>
              <Box sx={{ width: 16, height: 10, background: truthColor(0.5), mx: 0.5 }} />
              <Typography variant="caption">neutral</Typography>
              <Box sx={{ width: 16, height: 10, background: truthColor(1), mx: 0.5 }} />
              <Typography variant="caption">true</Typography>
            </Box>
          </Collapse>
        </Box>
      </Paper>

      {data && data.nodes.size === 0 && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.6 }}>
          <Typography variant="body2" color="text.secondary">
            no claims match this seed.
          </Typography>
        </Box>
      )}

      {data && data.nodes.size > 0 && ReactFlow && (
        <ReactFlow
          nodes={rfData.nodes}
          edges={rfData.edges}
          nodesDraggable
          onInit={(inst) => { rfInstance.current = inst; inst.fitView({ padding: 0.2 }); }}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_, n) => {
            const node = data.nodes.get(n.id);
            if (node) nav(`/video/${node.claim.videoId}#claim-${n.id}`);
          }}
          onPaneClick={() => setSelectedId(null)}
          fitView
          minZoom={0.1}
          maxZoom={4}
        >
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              // Use the node's own background when it has one (truth-
              // colored claim nodes). Fall back to a theme-neutral tone.
              const bg = (n.style as { background?: string } | undefined)?.background;
              return bg ?? "#9e9e9e";
            }}
            maskColor="rgba(0,0,0,0.55)"
            style={{
              background: "#1e1e1e",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          />
        </ReactFlow>
      )}

      {sel && (
        <Paper sx={{ position: "absolute", top: 12, right: 12, zIndex: 10, p: 1.5, width: 320, maxHeight: "calc(100vh - 100px)", overflow: "auto" }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
            <Chip size="small" label={sel.claim.kind} />
            {sel.claim.hostStance && (
              <Chip size="small" variant="outlined" label={`host: ${sel.claim.hostStance}`} />
            )}
          </Stack>
          <Typography variant="body2" sx={{ mb: 1 }}>{sel.claim.text}</Typography>
          <TruthBar value={sel.truth} source={sel.claim.truthSource} label="truth" />
          <TruthBar value={sel.claim.confidence} label="confidence" />
          <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {sel.claim.entities.slice(0, 8).map((e) => (
              <Chip key={e} size="small" variant="outlined" label={e} onClick={() => nav(`/entity/${encodeURIComponent(e)}`)} />
            ))}
          </Box>
          {sel.claim.tags && sel.claim.tags.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {sel.claim.tags.map((t) => (
                <Typography key={t} component="span" variant="caption" sx={{ color: "text.secondary", mr: 0.5, fontFamily: "monospace" }}>#{t}</Typography>
              ))}
            </Box>
          )}
          <Box sx={{ mt: 1 }}>
            <MuiLink component="button" variant="caption" onClick={() => nav(`/video/${sel.claim.videoId}#claim-${sel.id}`)}>
              open on video page →
            </MuiLink>
          </Box>
        </Paper>
      )}
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function textColor(t: number | null): string {
  if (t === null) return "#222";
  // pick white text when the bg is dark-ish (low or high truth)
  return t < 0.35 || t > 0.75 ? "#fff" : "#111";
}
