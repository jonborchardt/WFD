import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Node as RfNode, Edge as RfEdge, ReactFlowInstance, NodeMouseHandler } from "reactflow";
import type ELKCtor from "elkjs/lib/elk.bundled.js";

type ELKInstance = InstanceType<typeof ELKCtor>;
import {
  Autocomplete,
  Box,
  MenuItem,
  Paper,
  TextField,
  Typography,
  Chip,
  Button,
  Link as MuiLink,
  Stack,
} from "@mui/material";
import { CollapseSection } from "../components/CollapseSection";
import { EmptyUfo, UfoLoader } from "../components/brand";
import { SpacingSlider } from "../components/SpacingSlider";
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
import { entityChipSx } from "../lib/facet-helpers";
import { truthColor } from "../lib/truth-palette";
import { colors } from "../theme";
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

type LayoutAlgo = "force" | "stress" | "radial" | "circular";
type Pos = { x: number; y: number };
type PositionMap = Record<string, Pos>;

// Pure-JS layouts for claim nodes (uniform size). Used when the user
// picks radial/circular from the layout dropdown — ELK only handles
// force/stress here.
function circularClaimLayout(nodeIds: string[], spacing: number): PositionMap {
  const out: PositionMap = {};
  const n = nodeIds.length;
  if (n === 0) return out;
  const scale = spacing / 80;
  const radius = Math.max(200 * scale, (n * (NODE_WIDTH + 40 * scale)) / (2 * Math.PI));
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    out[nodeIds[i]] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  return out;
}

function radialClaimLayout(nodes: ClaimGraphNode[], spacing: number): PositionMap {
  const out: PositionMap = {};
  if (nodes.length === 0) return out;
  const rings = new Map<number, string[]>();
  for (const n of nodes) {
    const lv = Math.max(0, n.distance);
    if (!rings.has(lv)) rings.set(lv, []);
    rings.get(lv)!.push(n.id);
  }
  const scale = spacing / 80;
  const ringSpacing = NODE_WIDTH * 1.4 * scale + 80 * scale;
  for (const [lv, ids] of rings) {
    const radius = lv === 0 ? (ids.length === 1 ? 0 : 80 * scale) : lv * ringSpacing;
    for (let i = 0; i < ids.length; i++) {
      const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
      out[ids[i]] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    }
  }
  return out;
}

// Compute new positions for a claim graph. Pre-placed nodes in
// `basePositions` are kept; missing ones get fresh coordinates from
// the chosen layout (ELK for force/stress, pure-JS for radial/circular).
async function computeClaimGraphLayout(
  data: ClaimGraphData,
  basePositions: PositionMap,
  algo: LayoutAlgo,
  spacing: number,
  elk: ELKInstance,
): Promise<PositionMap> {
  const allIds = [...data.nodes.keys()];
  if (allIds.length === 0) return {};

  if (algo === "circular") {
    return { ...basePositions, ...circularClaimLayout(allIds, spacing) };
  }
  if (algo === "radial") {
    return { ...basePositions, ...radialClaimLayout([...data.nodes.values()], spacing) };
  }

  const missing = allIds.filter((id) => !(id in basePositions));
  const elkNodes = allIds.map((id) => ({
    id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    ...(basePositions[id] ? { x: basePositions[id].x, y: basePositions[id].y } : {}),
  }));
  const elkEdges = [...data.edges.values()].map((e) => ({
    id: e.id,
    sources: [e.from],
    targets: [e.to],
  }));
  const layoutOptions: Record<string, string> = algo === "stress"
    ? {
        "elk.algorithm": "stress",
        "elk.spacing.nodeNode": String(spacing),
        "elk.stress.desiredEdgeLength": String(spacing * 2),
        "elk.stress.iterationLimit": "300",
      }
    : {
        "elk.algorithm": "force",
        "elk.spacing.nodeNode": String(spacing),
        // Hint ELK to respect pre-placed coordinates where available.
        "elk.force.iterations": String(missing.length === allIds.length ? 300 : 100),
      };

  const result = await elk.layout({ id: "root", layoutOptions, children: elkNodes, edges: elkEdges });
  const next: PositionMap = { ...basePositions };
  for (const c of result.children ?? []) {
    if (c.id && c.x !== undefined && c.y !== undefined && !(c.id in basePositions)) {
      next[c.id] = { x: c.x, y: c.y };
    }
  }
  return next;
}

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
  // No hardcoded default seed — land on an empty canvas when the URL
  // carries nothing, so direct visits don't imply a demo pick. The
  // HomePage "Start here" card supplies its own `?kind=…&q=…` to
  // seed the Marfa-Lights demo on click-through.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [seedKind, setSeedKind] = useState<"video" | "entity" | "claim">(
    (params.get("kind") as "video" | "entity" | "claim") ?? "claim",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSeeds, setActiveSeeds] = useState<ActiveSeed[]>([]);
  const [showLegend, setShowLegend] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [layoutAlgo, setLayoutAlgo] = useState<LayoutAlgo>("force");
  const [spacing, setSpacing] = useState(80);
  // Controlled separately from `query` (which holds the picked option's
  // id) so we can wipe the visible text after a selection — Autocomplete
  // otherwise leaves the just-picked label sitting in the input.
  const [inputValue, setInputValue] = useState("");
  // Seeds panel is collapsible. Default open when the list is small
  // enough to read at a glance; default closed once the user arrives
  // from a "graph these" bulk seeding (where the chips would eat
  // most of the sidebar).
  const [showSeeds, setShowSeeds] = useState(true);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  // Tracks the (algo, spacing) tuple that produced `positions`. When it
  // changes we discard pre-placed coordinates so the slider/dropdown
  // actually move things — otherwise the pre-placement hint pins
  // everything in place.
  const layoutKeyRef = useRef<string>(`force|80`);

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

  // Append an option's neighborhood to the existing graph (matches
  // the entity-map's add-on-pick behavior — selecting an item in
  // the autocomplete always adds, never replaces). Resets the search
  // field so the user can immediately type the next seed.
  const addOption = useCallback((opt: SeedOption | null) => {
    if (!ready || !opt) return;
    const next: ActiveSeed = { kind: seedKind, id: opt.id, label: opt.label };
    if (activeSeeds.some((s) => s.kind === next.kind && s.id === next.id)) return;
    const nextSeeds = [...activeSeeds, next];
    setActiveSeeds(nextSeeds);
    rebuildFromSeeds(nextSeeds);
    setParams({ kind: seedKind, q: opt.id });
    setQuery("");
    setInputValue("");
  }, [ready, seedKind, activeSeeds, rebuildFromSeeds, setParams]);

  const runAdd = useCallback(() => {
    if (currentOption) addOption(currentOption);
  }, [currentOption, addOption]);

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
    // Bulk seeding arrives with many chips — collapse by default so
    // the sidebar stays scannable. User can toggle back open.
    if (seeds.length > 6) setShowSeeds(false);
  }, [ready, params, options, rebuildFromSeeds]);

  // Auto-run on initial load if query present (single-seed path).
  // Skipped when the multi-seed effect above fired.
  useEffect(() => {
    if (multiSeedRanRef.current) return;
    if (ready && query && !data && currentOption) addOption(currentOption);
  }, [ready, query, data, currentOption, addOption]);

  // Layout whenever new nodes appear, the layout algo changes, or the
  // spacing slider moves. User-dragged positions are preserved unless
  // algo/spacing changed (a deliberate full re-layout).
  useEffect(() => {
    if (!data || !flowLib) return;
    if (data.nodes.size === 0) {
      setPositions({});
      return;
    }
    const layoutKey = `${layoutAlgo}|${spacing}`;
    const layoutChanged = layoutKeyRef.current !== layoutKey;
    layoutKeyRef.current = layoutKey;
    const basePositions = layoutChanged ? {} : positions;
    const missing = [...data.nodes.keys()].filter((id) => !(id in basePositions));
    if (missing.length === 0) return;

    let cancelled = false;
    computeClaimGraphLayout(data, basePositions, layoutAlgo, spacing, flowLib.elk).then((next) => {
      if (cancelled) return;
      setPositions(next);
      // Delay one frame so ReactFlow picks up the new positions before
      // we measure for fitView.
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 400 }), 60);
    });
    return () => {
      cancelled = true;
    };
    // positions is intentionally excluded — we only re-run on data/algo/
    // spacing changes. User drags call setPositions directly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, flowLib, layoutAlgo, spacing]);

  const onNodeDragStop: NodeMouseHandler = (_, node) => {
    setPositions((p) => ({ ...p, [node.id]: { x: node.position.x, y: node.position.y } }));
  };

  const rfData = useMemo(() => {
    if (!data) return { nodes: [] as RfNode[], edges: [] as RfEdge[] };
    const rfNodes: RfNode[] = [...data.nodes.values()].map((n) => {
      const pos = positions[n.id] ?? { x: 0, y: 0 };
      const color = n.truth !== null ? truthColor(n.truth) : colors.entity.time;
      const selected = selectedId === n.id;
      const seed = n.distance === 0;
      return {
        id: n.id,
        position: { x: pos.x, y: pos.y },
        data: { label: truncate(n.claim.text, 80) },
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          // Use `backgroundColor` not `background`: ReactFlow's default
          // `.react-flow__node-default` CSS sets `background-color: white`,
          // which the `background` shorthand inline style doesn't reliably
          // override through the wrapper.
          backgroundColor: color,
          color: textColor(n.truth),
          border: selected ? `3px solid ${colors.surface.textOnColor}` : seed ? `2px solid ${colors.surface.textOnColor}` : "1px solid rgba(0,0,0,0.3)",
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
      labelStyle: { fontSize: 10, fill: colors.surface.textOnColor },
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
        <UfoLoader size={56} />
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
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Argument map</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          {(["entity", "video", "claim"] as const).map((k) => (
            <Chip
              key={k}
              size="small"
              label={k}
              color={seedKind === k ? "primary" : "default"}
              onClick={() => { setSeedKind(k); setQuery(""); setInputValue(""); }}
              clickable
            />
          ))}
        </Stack>
        <Autocomplete
          size="small"
          fullWidth
          options={options}
          value={currentOption}
          onChange={(_, v) => { if (v) addOption(v); else setQuery(""); }}
          inputValue={inputValue}
          onInputChange={(_, v, reason) => { if (reason !== "reset") setInputValue(v); }}
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
                  ? "search entities to add to graph…"
                  : seedKind === "video"
                    ? "search videos to add to graph…"
                    : "search claims to add to graph…"
              }
              onKeyDown={(e) => { if (e.key === "Enter" && currentOption) runAdd(); }}
            />
          )}
        />
        {activeSeeds.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" variant="text" onClick={clearAll}>
              clear
            </Button>
          </Stack>
        )}

        {activeSeeds.length > 0 && (
          <CollapseSection
            title="seeds"
            count={activeSeeds.length}
            open={showSeeds}
            onToggle={() => setShowSeeds((v) => !v)}
          >
            <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
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
          </CollapseSection>
        )}

        {data && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {data.nodes.size} claims · {data.edges.size} edges
          </Typography>
        )}

        <CollapseSection
          title="options"
          open={showOptions}
          onToggle={() => setShowOptions((v) => !v)}
        >
          <Box sx={{ mt: 0.5 }}>
            <TextField
              select
              size="small"
              label="layout"
              value={layoutAlgo}
              onChange={(e) => setLayoutAlgo(e.target.value as LayoutAlgo)}
              fullWidth
            >
              <MenuItem value="force">Force</MenuItem>
              <MenuItem value="stress">Stress</MenuItem>
              <MenuItem value="radial">Radial</MenuItem>
              <MenuItem value="circular">Circular</MenuItem>
            </TextField>
            <SpacingSlider value={spacing} min={30} max={300} onChange={setSpacing} />
          </Box>
        </CollapseSection>

        <CollapseSection
          title="legend"
          open={showLegend}
          onToggle={() => setShowLegend((v) => !v)}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mt: 0.5 }}>edge color = relation</Typography>
          <Stack sx={{ mt: 0.25 }} spacing={0.25}>
            {Object.entries(EDGE_COLOR).map(([k, c]) => (
              <Box key={k} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box sx={{ width: 16, height: 4, backgroundColor: c }} />
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
        </CollapseSection>
      </Paper>

      {data && data.nodes.size === 0 && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <EmptyUfo
            message="no signals detected"
            hint="no claims match this seed. Try a different entity, video, or claim id."
          />
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
              return bg ?? colors.entity.specific_date_time;
            }}
            maskColor="rgba(0,0,0,0.55)"
            style={{
              background: colors.surface.base,
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
              <Chip key={e} size="small" variant="outlined" label={e}
                onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
                sx={entityChipSx(e)}
              />
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
  // Null-truth falls back to a light-gray entity tone; dark text reads.
  // Every truthColor(t) for t ∈ [0,1] mixes through colors.truth.{no,
  // neutral,yes} — all dark enough that white text has WCAG AA contrast.
  return t === null ? colors.surface.textOnColor : "white";
}
