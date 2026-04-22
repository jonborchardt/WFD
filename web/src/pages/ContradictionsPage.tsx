// Faceted contradictions browser — same rail idiom as ClaimsPage.
// Every tab / chip / spinner on the legacy view is a facet card
// here (kind, cross-video match reason, shared-entity count brush,
// text-similarity brush, publish-date brush, entity cards, video).

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Chip, TextField, Typography,
} from "@mui/material";
import { PageLoading } from "../components/PageLoading";
import { ContradictionResultRow } from "../components/ContradictionResultRow";
import { FacetCard } from "../components/facets/FacetCard";
import { BarListFacet, type BarRow } from "../components/facets/BarListFacet";
import { NumericRangeFacet } from "../components/facets/NumericRangeFacet";
import { DateBrushFacet } from "../components/facets/DateBrushFacet";
import { SortFacet, type SortOption } from "../components/facets/SortFacet";
import {
  buildEntityBucketsByType, buildEntityChipSlots, stripEntityType,
} from "../components/facets/entity-buckets";
import { FacetSection } from "../components/facets/FacetSection";
import { FilterChipStrip, type ChipSlot } from "../components/facets/FilterChipStrip";
import {
  DebouncedSearchField, FacetsPageHeader, FacetsPageOuter, RailResultsLayout,
} from "../components/facets/FacetsPageShell";
import { GraphSeedsButton } from "../components/facets/GraphSeedsButton";
import {
  binIntegerCounts, binUnitInterval, invalidateClaimsBundle,
  loadClaimsBundle,
  type ClaimsBundle,
} from "../components/facets/claims-duck";
import {
  ENTITY_PRIORITY, ENTITY_TYPE_COLOR, dateRangeStr,
  fmtDay, parseDateRange, parseRange, rangeStr, splitEntityKey,
} from "../lib/facet-helpers";
import { invalidateClaimsCaches } from "../lib/data";
import { matchesTopic } from "../lib/claim-search";
import { beginLoad } from "../lib/loading";
import { colors } from "../theme";
import type { ClaimContradiction } from "../types";

const FACET = colors.facet;


const SORT_OPTIONS: SortOption[] = [
  { value: "shared-desc", label: "most shared entities" },
  { value: "similarity-desc", label: "highest text similarity",
    hint: "jaccard desc (cross-video only)" },
  { value: "kind", label: "group by kind" },
];

const KIND_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["pair", "pair"],
  ["broken-presupposition", "broken presupp"],
  ["cross-video", "cross-video"],
  ["manual", "manual"],
];

const REASON_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["jaccard", "jaccard"],
  ["strong-overlap", "strong-overlap"],
  ["__none__", "(none)"],
];

const PER_TYPE_VISIBLE = 8;

interface FilterState {
  q: string;
  kinds: Set<string>;
  reasons: Set<string>;              // "jaccard" | "strong-overlap" | "__none__"
  sharedRange: [number, number] | null;
  simRange: [number, number] | null;
  dateRange: [number, number] | null;
  entities: Set<string>;
  videos: Set<string>;
  sort: string;
}

const STRING_SET_KEYS = [
  "kinds", "reasons", "entities", "videos",
] as const;
type StringSetKey = (typeof STRING_SET_KEYS)[number];

const EMPTY: FilterState = {
  q: "",
  kinds: new Set(),
  reasons: new Set(),
  sharedRange: null,
  simRange: null,
  dateRange: null,
  entities: new Set(),
  videos: new Set(),
  sort: "shared-desc",
};

function parseFromUrl(): FilterState {
  if (typeof window === "undefined") return { ...EMPTY };
  const p = new URLSearchParams(window.location.search);
  const setOf = (k: string) =>
    new Set((p.get(k) || "").split(",").filter(Boolean));
  return {
    q: p.get("q") || "",
    kinds: setOf("kind"),
    reasons: setOf("reason"),
    sharedRange: parseRange(p.get("shared")),
    simRange: parseRange(p.get("sim")),
    dateRange: parseDateRange(p.get("date")),
    entities: setOf("entity"),
    videos: setOf("video"),
    sort: p.get("sort") || "shared-desc",
  };
}

function writeToUrl(s: FilterState) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  const setParam = (k: string, v: Set<string>) => {
    if (v.size > 0) p.set(k, [...v].join(","));
  };
  setParam("kind", s.kinds);
  setParam("reason", s.reasons);
  if (s.sharedRange) p.set("shared", rangeStr(s.sharedRange));
  if (s.simRange) p.set("sim", rangeStr(s.simRange));
  if (s.dateRange) p.set("date", dateRangeStr(s.dateRange));
  setParam("entity", s.entities);
  setParam("video", s.videos);
  if (s.sort !== "shared-desc") p.set("sort", s.sort);
  const qs = p.toString();
  window.history.replaceState({}, "",
    window.location.pathname + (qs ? "?" + qs : ""));
}

function passes(
  c: ClaimContradiction, s: FilterState, bundle: ClaimsBundle,
): boolean {
  const q = s.q.trim().toLowerCase();
  const left = bundle.claimsById.get(c.left);
  const right = bundle.claimsById.get(c.right);

  if (s.kinds.size > 0 && !s.kinds.has(c.kind)) return false;
  if (s.reasons.size > 0 && !s.reasons.has(c.matchReason ?? "__none__")) return false;

  const shared = c.sharedEntities?.length ?? 0;
  if (s.sharedRange && (shared < s.sharedRange[0] || shared > s.sharedRange[1])) return false;

  if (s.simRange) {
    const sim = c.similarity ?? null;
    if (sim === null || sim < s.simRange[0] || sim > s.simRange[1]) return false;
  }

  if (s.dateRange) {
    // Pass if either side's video falls inside the range.
    const lMs = left ? bundle.videosById.get(left.videoId)?.publishMs ?? null : null;
    const rMs = right ? bundle.videosById.get(right.videoId)?.publishMs ?? null : null;
    const [lo, hi] = s.dateRange;
    const lOk = lMs != null && lMs >= lo && lMs <= hi;
    const rOk = rMs != null && rMs >= lo && rMs <= hi;
    if (!lOk && !rOk) return false;
  }

  if (s.videos.size > 0) {
    const lv = left?.videoId;
    const rv = right?.videoId;
    if (!(lv && s.videos.has(lv)) && !(rv && s.videos.has(rv))) return false;
  }

  if (s.entities.size > 0) {
    // Within one entity type: OR. Across entity types: AND. Matches
    // how the chip strip groups selections visually.
    const she = new Set(c.sharedEntities ?? []);
    const byType = new Map<string, string[]>();
    for (const e of s.entities) {
      const t = splitEntityKey(e).type;
      const arr = byType.get(t) ?? [];
      arr.push(e);
      byType.set(t, arr);
    }
    for (const values of byType.values()) {
      let any = false;
      for (const v of values) if (she.has(v)) { any = true; break; }
      if (!any) return false;
    }
  }

  if (q) {
    if (c.summary.toLowerCase().includes(q)) return true;
    if (left?.text.toLowerCase().includes(q)) return true;
    if (right?.text.toLowerCase().includes(q)) return true;
    if ((c.sharedEntities ?? []).some((e) => e.toLowerCase().includes(q))) return true;
    if (left && matchesTopic(left, s.q)) return true;
    if (right && matchesTopic(right, s.q)) return true;
    return false;
  }
  return true;
}

function applyExcept(
  rows: ClaimContradiction[], s: FilterState, bundle: ClaimsBundle,
  exclude: keyof FilterState,
): ClaimContradiction[] {
  const stripped: FilterState = { ...s };
  switch (exclude) {
    case "kinds": stripped.kinds = new Set(); break;
    case "reasons": stripped.reasons = new Set(); break;
    case "sharedRange": stripped.sharedRange = null; break;
    case "simRange": stripped.simRange = null; break;
    case "dateRange": stripped.dateRange = null; break;
    case "entities": stripped.entities = new Set(); break;
    case "videos": stripped.videos = new Set(); break;
    case "q": stripped.q = ""; break;
  }
  return rows.filter((c) => passes(c, stripped, bundle));
}

export function ContradictionsPage() {
  const nav = useNavigate();
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
  const [filter, setFilter] = useState<FilterState>(() => parseFromUrl());
  const [entitySearch, setEntitySearch] = useState<Record<string, string>>({});
  const [videoSearch, setVideoSearch] = useState("");
  const [showAllByType, setShowAllByType] =
    useState<Record<string, boolean>>({});
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const end = beginLoad();
    loadClaimsBundle().then(setBundle).finally(end);
  }, [reloadTick]);

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    writeToUrl(filter);
  }, [filter]);

  const onMutated = () => {
    invalidateClaimsCaches();
    invalidateClaimsBundle();
    setReloadTick((t) => t + 1);
  };

  const setF = (p: Partial<FilterState>) => setFilter((f) => ({ ...f, ...p }));
  const toggleString = (key: StringSetKey, value: string) => {
    setFilter((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });
  };
  const clearAll = () => setFilter({ ...EMPTY });

  const filtered = useMemo(() => {
    if (!bundle) return [];
    return bundle.contradictions.filter((c) => passes(c, filter, bundle));
  }, [bundle, filter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (filter.sort) {
      case "shared-desc":
        rows.sort((a, b) =>
          (b.sharedEntities?.length ?? 0) - (a.sharedEntities?.length ?? 0));
        break;
      case "similarity-desc":
        rows.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
        break;
      case "kind":
        rows.sort((a, b) => a.kind.localeCompare(b.kind));
        break;
    }
    return rows;
  }, [filtered, filter.sort]);

  if (!bundle) {
    return <PageLoading
      label="loading contradictions…"
      hint="fetching contradictions and claim index"
    />;
  }

  const kindScope = applyExcept(bundle.contradictions, filter, bundle, "kinds");
  const reasonScope = applyExcept(bundle.contradictions, filter, bundle, "reasons");
  const sharedScope = applyExcept(bundle.contradictions, filter, bundle, "sharedRange");
  const simScope = applyExcept(bundle.contradictions, filter, bundle, "simRange");
  const dateScope = applyExcept(bundle.contradictions, filter, bundle, "dateRange");
  const videoScope = applyExcept(bundle.contradictions, filter, bundle, "videos");

  const kindRows = makeCountRows(KIND_LABELS, kindScope, (c) => c.kind);
  const reasonRows = makeCountRows(
    REASON_LABELS, reasonScope, (c) => c.matchReason ?? "__none__",
  );

  const maxShared = bundle.contradictions
    .reduce((m, c) => Math.max(m, c.sharedEntities?.length ?? 0), 0);
  const sharedBins = binIntegerCounts(
    sharedScope.map((c) => c.sharedEntities?.length ?? 0),
    Math.max(4, maxShared),
  );
  const simBins = binUnitInterval(
    simScope.map((c) => c.similarity ?? null),
    0.05,
  );

  // Dates: use each contradiction's earlier side so one dot per
  // contradiction, matching how the shared/sim brushes count items.
  const dateTimestamps: number[] = [];
  for (const c of dateScope) {
    const lv = bundle.claimsById.get(c.left)?.videoId;
    const rv = bundle.claimsById.get(c.right)?.videoId;
    const lMs = lv ? bundle.videosById.get(lv)?.publishMs ?? null : null;
    const rMs = rv ? bundle.videosById.get(rv)?.publishMs ?? null : null;
    const candidates = [lMs, rMs].filter((v): v is number => v != null);
    if (candidates.length > 0) dateTimestamps.push(Math.min(...candidates));
  }

  const entityByType = buildEntityBucketsByType(
    bundle.contradictions,
    filter.entities,
    (type) => {
      const stripped = stripEntityType(filter, type);
      return bundle.contradictions.filter((c) => passes(c, stripped, bundle));
    },
    (c) => c.sharedEntities,
  );
  const orderedTypes = [
    ...ENTITY_PRIORITY.filter((t) => entityByType.has(t)),
    ...[...entityByType.keys()].filter((t) => !ENTITY_PRIORITY.includes(t)),
  ];

  // Count each contradiction under both its videos; label with
  // truncated title, id is the stable selection key.
  const videoCounts = new Map<string, number>();
  for (const c of videoScope) {
    const lv = bundle.claimsById.get(c.left)?.videoId;
    const rv = bundle.claimsById.get(c.right)?.videoId;
    const ids = new Set<string>();
    if (lv) ids.add(lv);
    if (rv) ids.add(rv);
    for (const id of ids) {
      videoCounts.set(id, (videoCounts.get(id) ?? 0) + 1);
    }
  }
  const videoRows: BarRow[] = [...videoCounts.entries()]
    .map(([id, count]) => {
      const meta = bundle.videosById.get(id);
      return {
        id,
        label: meta?.shortLabel ?? id,
        title: meta?.title ?? id,
        count,
      };
    })
    .filter((r) => {
      if (!videoSearch) return true;
      const q = videoSearch.toLowerCase();
      return r.label.toLowerCase().includes(q)
        || (r.title?.toLowerCase().includes(q) ?? false)
        || r.id.toLowerCase().includes(q);
    })
    .sort((a, b) => b.count - a.count);

  // Active-filter chip strip, one slot per facet. All facets here
  // are OR within the slot; between slots is AND (standard).
  const chipSlots: ChipSlot[] = [];
  if (filter.q) chipSlots.push({
    key: "q", conj: "OR",
    items: [{
      id: "q", label: `text: ${filter.q}`,
      onClear: () => setF({ q: "" }),
    }],
  });
  for (const key of STRING_SET_KEYS) {
    if (key === "videos") continue;
    if (key === "entities") continue; // grouped per-type below
    const values = [...filter[key]];
    if (values.length === 0) continue;
    chipSlots.push({
      key, conj: "OR",
      items: values.map((v) => ({
        id: v,
        label: `${STRING_KEY_LABEL[key]}: ${v}`,
        onClear: () => toggleString(key, v),
      })),
    });
  }
  chipSlots.push(...buildEntityChipSlots(
    filter.entities,
    (v) => toggleString("entities", v),
  ));
  if (filter.sharedRange) chipSlots.push({
    key: "shared", conj: "OR", items: [{
      id: "shared",
      label: `shared ${filter.sharedRange[0]}–${filter.sharedRange[1]}`,
      onClear: () => setF({ sharedRange: null }),
    }],
  });
  if (filter.simRange) chipSlots.push({
    key: "sim", conj: "OR", items: [{
      id: "sim",
      label: `similarity ${filter.simRange[0].toFixed(2)}–${filter.simRange[1].toFixed(2)}`,
      onClear: () => setF({ simRange: null }),
    }],
  });
  if (filter.dateRange) chipSlots.push({
    key: "date", conj: "OR", items: [{
      id: "date",
      label: `date ${fmtDay(filter.dateRange[0])}–${fmtDay(filter.dateRange[1])}`,
      onClear: () => setF({ dateRange: null }),
    }],
  });
  if (filter.videos.size > 0) chipSlots.push({
    key: "videos", conj: "OR",
    items: [...filter.videos].map((id) => {
      const t = bundle.videosById.get(id);
      return {
        id,
        label: `video: ${t?.shortLabel ?? id}`,
        title: t?.title,
        onClear: () => toggleString("videos", id),
      };
    }),
  });
  const hasChips = chipSlots.length > 0;

  // Seeds for the "graph these" button: both sides of every filtered
  // pair, order preserved so the first few contradictions' claims
  // appear first when the cap kicks in.
  const graphSeeds: string[] = [];
  for (const c of sorted) {
    graphSeeds.push(c.left, c.right);
  }

  const rail = (
    <>
      <DebouncedSearchField
        value={filter.q}
        onCommit={(v) => setF({ q: v })}
        placeholder="search summary, either claim, shared entity…"
      />
          <FacetSection title="sort">
            <FacetCard label="sort by" color={FACET.sort}>
              <SortFacet
                options={SORT_OPTIONS}
                value={filter.sort}
                onChange={(v) => setF({ sort: v })}
              />
            </FacetCard>
          </FacetSection>

          <FacetSection title="kind">
            <FacetCard
              label="kind" color={FACET.kind}
              selected={filter.kinds.size} total={kindRows.length}
            >
              <BarListFacet
                rows={kindRows} selected={filter.kinds}
                onToggle={(v) => toggleString("kinds", v)}
              />
            </FacetCard>
            <FacetCard
              label="cross-video match" color={FACET.crossVideo}
              selected={filter.reasons.size} total={reasonRows.length}
            >
              <BarListFacet
                rows={reasonRows} selected={filter.reasons}
                onToggle={(v) => toggleString("reasons", v)}
              />
            </FacetCard>
          </FacetSection>

          <FacetSection title="magnitudes">
            <FacetCard
              label="shared entities" color={FACET.sharedEntities}
              selected={filter.sharedRange ? 1 : 0}
            >
              <NumericRangeFacet
                bins={sharedBins}
                domain={[0, Math.max(4, maxShared)]}
                selected={filter.sharedRange}
                onChange={(r) => setF({ sharedRange: r })}
                format={(v) => Math.round(v).toString()}
              />
            </FacetCard>
            <FacetCard
              label="text similarity" color={FACET.similarity}
              selected={filter.simRange ? 1 : 0}
            >
              <NumericRangeFacet
                bins={simBins} domain={[0, 1]}
                selected={filter.simRange}
                onChange={(r) => setF({ simRange: r })}
              />
            </FacetCard>
            <FacetCard
              label="publish date" color={FACET.publishDate}
              selected={filter.dateRange ? 1 : 0}
            >
              <DateBrushFacet
                timestamps={dateTimestamps}
                selected={filter.dateRange}
                onChange={(r) => setF({ dateRange: r })}
              />
            </FacetCard>
          </FacetSection>

          <FacetSection title="entities">
            {orderedTypes.map((type) => {
              const bucket = entityByType.get(type)!;
              const color = ENTITY_TYPE_COLOR[type] || FACET.accent;
              const selectedInType = [...filter.entities]
                .filter((k) => splitEntityKey(k).type === type).length;
              if (bucket.size === 0) {
                return (
                  <FacetCard
                    key={type}
                    label={type} color={color}
                    selected={selectedInType} total={0}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{
                      display: "block", px: 0.5, fontSize: 10,
                    }}>
                      no matches under current filter
                    </Typography>
                  </FacetCard>
                );
              }
              const q = (entitySearch[type] || "").toLowerCase();
              const all: BarRow[] = [...bucket.entries()]
                .map(([id, v]) => ({ id, label: v.label, count: v.count }))
                .filter((r) => !q || r.label.toLowerCase().includes(q))
                .sort((a, b) => b.count - a.count);
              const limit = showAllByType[type] ? 200 : PER_TYPE_VISIBLE;
              return (
                <FacetCard
                  key={type}
                  label={type} color={color}
                  selected={selectedInType} total={bucket.size}
                >
                  <TextField
                    size="small"
                    placeholder="search…"
                    value={entitySearch[type] || ""}
                    onChange={(e) => setEntitySearch((s) => ({
                      ...s, [type]: e.target.value,
                    }))}
                    fullWidth
                    sx={compactInputSx}
                  />
                  <BarListFacet
                    rows={all.slice(0, limit)}
                    selected={filter.entities}
                    onToggle={(v) => toggleString("entities", v)}
                    color={color}
                  />
                  {all.length > PER_TYPE_VISIBLE && (
                    <Button
                      size="small"
                      onClick={() => setShowAllByType((s) => ({
                        ...s, [type]: !s[type],
                      }))}
                      sx={{ fontSize: 10, py: 0, minHeight: 20, px: 0.5 }}
                    >
                      {showAllByType[type]
                        ? "top 8"
                        : `+${all.length - PER_TYPE_VISIBLE} more`}
                    </Button>
                  )}
                </FacetCard>
              );
            })}
          </FacetSection>

          <FacetSection title="video">
            <FacetCard
              label="video" color={FACET.video}
              selected={filter.videos.size} total={videoRows.length}
            >
              <TextField
                size="small"
                placeholder="search title or id…"
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
                fullWidth
                sx={compactInputSx}
              />
              <BarListFacet
                rows={videoRows.slice(0, 12)}
                selected={filter.videos}
                onToggle={(v) => toggleString("videos", v)}
              />
            </FacetCard>
          </FacetSection>
    </>
  );

  const results = (
    <>
      <FilterChipStrip
        slots={chipSlots}
        onClearAll={hasChips ? clearAll : undefined}
      />
      {sorted.slice(0, 200).map((c, i) => (
        <ContradictionResultRow
          key={`${c.left}-${c.right}-${i}`}
          cx={c}
          bundle={bundle}
          nav={nav}
          onMutated={onMutated}
        />
      ))}
    </>
  );

  return (
    <FacetsPageOuter>
      <FacetsPageHeader
        title="Contradictions"
        matchCount={filtered.length}
        totalCount={bundle.contradictions.length}
        suffix={<GraphSeedsButton claimIds={graphSeeds} />}
      />
      <RailResultsLayout rail={rail} results={results} />
    </FacetsPageOuter>
  );
}

// ── building blocks ──────────────────────────────────────────────
const compactInputSx = {
  mb: 0.25,
  "& .MuiInputBase-input": { fontSize: 11, py: 0.25, px: 0.5 },
};

const STRING_KEY_LABEL: Record<StringSetKey, string> = {
  kinds: "kind",
  reasons: "reason",
  entities: "entity",
  videos: "video",
};

function makeCountRows<T>(
  entries: ReadonlyArray<readonly [string, string]>,
  items: T[],
  project: (item: T) => string,
): BarRow[] {
  const rows: BarRow[] = entries.map(([id, label]) => ({ id, label, count: 0 }));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  for (const it of items) {
    const row = byId.get(project(it));
    if (row) row.count += 1;
  }
  return rows;
}

