// Shared rail + results page for claim-pair browsers.
//
// Both /contradictions and /cross-video-agreements render the same
// dataset shape (ClaimContradiction rows) in the same rail-with-facets
// idiom. The two pages differ only in (a) which facets are relevant,
// (b) sort options + default, and (c) whether mutation actions are
// wired. This component is the single implementation they both
// compose around.
//
// The `facets` prop turns individual facet cards on and off; disabled
// facets also short-circuit their portion of `passes()` and are never
// written to the URL (so the agreements page doesn't carry a zombie
// ?kind= param).
//
// Row cap remains 200 for DOM sanity.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, TextField, Typography,
} from "@mui/material";
import { ContradictionResultRow } from "../ContradictionResultRow";
import { FacetCard } from "./FacetCard";
import { BarListFacet, type BarRow } from "./BarListFacet";
import { NumericRangeFacet } from "./NumericRangeFacet";
import { DateBrushFacet } from "./DateBrushFacet";
import { SortFacet, type SortOption } from "./SortFacet";
import {
  buildEntityBucketsByType, buildEntityChipSlots, stripEntityType,
} from "./entity-buckets";
import { FacetSection } from "./FacetSection";
import { FilterChipStrip, type ChipSlot } from "./FilterChipStrip";
import {
  DebouncedSearchField, FacetsPageHeader, FacetsPageOuter, RailResultsLayout,
} from "./FacetsPageShell";
import { GraphSeedsButton } from "./GraphSeedsButton";
import {
  binIntegerCounts, binUnitInterval, type ClaimsBundle,
} from "./claims-duck";
import {
  ENTITY_PRIORITY, ENTITY_TYPE_COLOR, dateRangeStr,
  fmtDay, parseDateRange, parseRange, rangeStr, splitEntityKey,
} from "../../lib/facet-helpers";
import { matchesTopic } from "../../lib/claim-search";
import { colors } from "../../theme";
import type { ClaimContradiction } from "../../types";

const FACET = colors.facet;
const PER_TYPE_VISIBLE = 8;

// Third tuple element is the hover tooltip rendered by BarListFacet —
// a plain-English definition of the categorical value.
export const KIND_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["pair", "same episode",
    "Two claims in the same episode that contradict each other."],
  ["broken-presupposition", "quiet assumption",
    "One claim quietly takes something for granted that another claim flat-out denies."],
  ["cross-video", "across episodes",
    "Two claims from different episodes that disagree. The site spotted them, then an AI double-checked that it's a real conflict."],
  ["manual", "added by hand",
    "A contradiction someone reviewing the site added, that the automatic detector missed."],
];

export const REASON_LABELS: ReadonlyArray<readonly [string, string, string]> = [
  ["jaccard", "shared words",
    "Found because the two claims share a lot of the same words."],
  ["strong-overlap", "shared entities",
    "Found because the two claims mention an unusual number of the same people, places, or things."],
  ["cosine", "similar meaning",
    "Found because the two claims mean similar things, even when they use different words."],
  ["__none__", "(none)",
    "No across-episode match reason — same-episode pair, added by hand, or older record."],
];

export interface FacetToggles {
  kind?: boolean;
  reason?: boolean;
  sharedEntities?: boolean;
  similarity?: boolean;
  publishDate?: boolean;
  entities?: boolean;
  videos?: boolean;
}

export interface FacetedPairsPageProps {
  title: string;
  description?: string;
  rows: ClaimContradiction[];
  bundle: ClaimsBundle;
  facets: FacetToggles;
  sortOptions: SortOption[];
  defaultSort: string;
  onMutated?: () => void;
  emptyMessage?: string;
  /**
   * Noun in the "N in corpus" label at the top of the page. Defaults
   * to the generic "in corpus" phrasing from FacetsPageHeader.
   */
  totalNoun?: string;
}

interface FilterState {
  q: string;
  kinds: Set<string>;
  reasons: Set<string>;
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

const STRING_KEY_LABEL: Record<StringSetKey, string> = {
  kinds: "kind",
  reasons: "reason",
  entities: "entity",
  videos: "video",
};

function emptyState(defaultSort: string): FilterState {
  return {
    q: "",
    kinds: new Set(),
    reasons: new Set(),
    sharedRange: null,
    simRange: null,
    dateRange: null,
    entities: new Set(),
    videos: new Set(),
    sort: defaultSort,
  };
}

function parseFromUrl(facets: FacetToggles, defaultSort: string): FilterState {
  const base = emptyState(defaultSort);
  if (typeof window === "undefined") return base;
  const p = new URLSearchParams(window.location.search);
  const setOf = (k: string) =>
    new Set((p.get(k) || "").split(",").filter(Boolean));
  return {
    q: p.get("q") || "",
    kinds: facets.kind ? setOf("kind") : new Set(),
    reasons: facets.reason ? setOf("reason") : new Set(),
    sharedRange: facets.sharedEntities ? parseRange(p.get("shared")) : null,
    simRange: facets.similarity ? parseRange(p.get("sim")) : null,
    dateRange: facets.publishDate ? parseDateRange(p.get("date")) : null,
    entities: facets.entities ? setOf("entity") : new Set(),
    videos: facets.videos ? setOf("video") : new Set(),
    sort: p.get("sort") || defaultSort,
  };
}

function writeToUrl(s: FilterState, facets: FacetToggles, defaultSort: string) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  const setParam = (k: string, v: Set<string>) => {
    if (v.size > 0) p.set(k, [...v].join(","));
  };
  if (facets.kind) setParam("kind", s.kinds);
  if (facets.reason) setParam("reason", s.reasons);
  if (facets.sharedEntities && s.sharedRange) p.set("shared", rangeStr(s.sharedRange));
  if (facets.similarity && s.simRange) p.set("sim", rangeStr(s.simRange));
  if (facets.publishDate && s.dateRange) p.set("date", dateRangeStr(s.dateRange));
  if (facets.entities) setParam("entity", s.entities);
  if (facets.videos) setParam("video", s.videos);
  if (s.sort !== defaultSort) p.set("sort", s.sort);
  const qs = p.toString();
  window.history.replaceState({}, "",
    window.location.pathname + (qs ? "?" + qs : ""));
}

function passes(
  c: ClaimContradiction, s: FilterState, bundle: ClaimsBundle,
  facets: FacetToggles,
): boolean {
  const q = s.q.trim().toLowerCase();
  const left = bundle.claimsById.get(c.left);
  const right = bundle.claimsById.get(c.right);

  if (facets.kind && s.kinds.size > 0 && !s.kinds.has(c.kind)) return false;
  if (facets.reason && s.reasons.size > 0
      && !s.reasons.has(c.matchReason ?? "__none__")) return false;

  if (facets.sharedEntities && s.sharedRange) {
    const shared = c.sharedEntities?.length ?? 0;
    if (shared < s.sharedRange[0] || shared > s.sharedRange[1]) return false;
  }

  if (facets.similarity && s.simRange) {
    const sim = c.similarity ?? null;
    if (sim === null || sim < s.simRange[0] || sim > s.simRange[1]) return false;
  }

  if (facets.publishDate && s.dateRange) {
    const lMs = left ? bundle.videosById.get(left.videoId)?.publishMs ?? null : null;
    const rMs = right ? bundle.videosById.get(right.videoId)?.publishMs ?? null : null;
    const [lo, hi] = s.dateRange;
    const lOk = lMs != null && lMs >= lo && lMs <= hi;
    const rOk = rMs != null && rMs >= lo && rMs <= hi;
    if (!lOk && !rOk) return false;
  }

  if (facets.videos && s.videos.size > 0) {
    const lv = left?.videoId;
    const rv = right?.videoId;
    if (!(lv && s.videos.has(lv)) && !(rv && s.videos.has(rv))) return false;
  }

  if (facets.entities && s.entities.size > 0) {
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
  facets: FacetToggles, exclude: keyof FilterState,
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
  return rows.filter((c) => passes(c, stripped, bundle, facets));
}

// Hide rows with zero count in the full-dataset projection, but keep
// any row the user has already selected (so unchecking it is still
// possible even if the current filter narrows it to nothing).
function dropZeroRows(rows: BarRow[], keepSelected: Set<string>): BarRow[] {
  return rows.filter((r) => r.count > 0 || keepSelected.has(r.id));
}

function makeCountRows<T>(
  entries: ReadonlyArray<readonly [string, string, string?]>,
  items: T[],
  project: (item: T) => string,
): BarRow[] {
  const rows: BarRow[] = entries.map(([id, label, title]) => ({
    id, label, count: 0, title,
  }));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  for (const it of items) {
    const row = byId.get(project(it));
    if (row) row.count += 1;
  }
  return rows;
}

const compactInputSx = {
  mb: 0.25,
  "& .MuiInputBase-input": { fontSize: 11, py: 0.25, px: 0.5 },
};

export function FacetedPairsPage({
  title, description, rows, bundle, facets,
  sortOptions, defaultSort, onMutated, emptyMessage, totalNoun,
}: FacetedPairsPageProps) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<FilterState>(
    () => parseFromUrl(facets, defaultSort),
  );
  const [entitySearch, setEntitySearch] = useState<Record<string, string>>({});
  const [videoSearch, setVideoSearch] = useState("");
  const [showAllByType, setShowAllByType] =
    useState<Record<string, boolean>>({});

  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    writeToUrl(filter, facets, defaultSort);
  }, [filter, facets, defaultSort]);

  const setF = (p: Partial<FilterState>) => setFilter((f) => ({ ...f, ...p }));
  const toggleString = (key: StringSetKey, value: string) => {
    setFilter((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });
  };
  const clearAll = () => setFilter(emptyState(defaultSort));

  const filtered = useMemo(() => {
    return rows.filter((c) => passes(c, filter, bundle, facets));
  }, [rows, bundle, filter, facets]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    switch (filter.sort) {
      case "shared-desc":
        out.sort((a, b) =>
          (b.sharedEntities?.length ?? 0) - (a.sharedEntities?.length ?? 0));
        break;
      case "similarity-desc":
        out.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));
        break;
      case "kind":
        out.sort((a, b) => a.kind.localeCompare(b.kind));
        break;
    }
    return out;
  }, [filtered, filter.sort]);

  const kindScope = facets.kind ? applyExcept(rows, filter, bundle, facets, "kinds") : rows;
  const reasonScope = facets.reason ? applyExcept(rows, filter, bundle, facets, "reasons") : rows;
  const sharedScope = facets.sharedEntities ? applyExcept(rows, filter, bundle, facets, "sharedRange") : rows;
  const simScope = facets.similarity ? applyExcept(rows, filter, bundle, facets, "simRange") : rows;
  const dateScope = facets.publishDate ? applyExcept(rows, filter, bundle, facets, "dateRange") : rows;
  const videoScope = facets.videos ? applyExcept(rows, filter, bundle, facets, "videos") : rows;

  const kindRows = dropZeroRows(
    makeCountRows(KIND_LABELS, kindScope, (c) => c.kind),
    filter.kinds,
  );
  const reasonRows = dropZeroRows(
    makeCountRows(REASON_LABELS, reasonScope, (c) => c.matchReason ?? "__none__"),
    filter.reasons,
  );

  const maxShared = rows.reduce(
    (m, c) => Math.max(m, c.sharedEntities?.length ?? 0), 0,
  );
  const sharedBins = binIntegerCounts(
    sharedScope.map((c) => c.sharedEntities?.length ?? 0),
    Math.max(4, maxShared),
  );
  const simBins = binUnitInterval(
    simScope.map((c) => c.similarity ?? null),
    0.05,
  );

  const dateTimestamps: number[] = [];
  for (const c of dateScope) {
    const lv = bundle.claimsById.get(c.left)?.videoId;
    const rv = bundle.claimsById.get(c.right)?.videoId;
    const lMs = lv ? bundle.videosById.get(lv)?.publishMs ?? null : null;
    const rMs = rv ? bundle.videosById.get(rv)?.publishMs ?? null : null;
    const candidates = [lMs, rMs].filter((v): v is number => v != null);
    if (candidates.length > 0) dateTimestamps.push(Math.min(...candidates));
  }

  const entityByType = facets.entities
    ? buildEntityBucketsByType(
        rows,
        filter.entities,
        (type) => {
          const stripped = stripEntityType(filter, type);
          return rows.filter((c) => passes(c, stripped, bundle, facets));
        },
        (c) => c.sharedEntities,
      )
    : new Map();
  const orderedTypes = [
    ...ENTITY_PRIORITY.filter((t) => entityByType.has(t)),
    ...[...entityByType.keys()].filter((t) => !ENTITY_PRIORITY.includes(t)),
  ];

  const videoCounts = new Map<string, number>();
  if (facets.videos) {
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
    if (key === "entities") continue;
    if (key === "kinds" && !facets.kind) continue;
    if (key === "reasons" && !facets.reason) continue;
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
  if (facets.entities) {
    chipSlots.push(...buildEntityChipSlots(
      filter.entities,
      (v) => toggleString("entities", v),
    ));
  }
  if (facets.sharedEntities && filter.sharedRange) chipSlots.push({
    key: "shared", conj: "OR", items: [{
      id: "shared",
      label: `shared ${filter.sharedRange[0]}–${filter.sharedRange[1]}`,
      onClear: () => setF({ sharedRange: null }),
    }],
  });
  if (facets.similarity && filter.simRange) chipSlots.push({
    key: "sim", conj: "OR", items: [{
      id: "sim",
      label: `similarity ${filter.simRange[0].toFixed(2)}–${filter.simRange[1].toFixed(2)}`,
      onClear: () => setF({ simRange: null }),
    }],
  });
  if (facets.publishDate && filter.dateRange) chipSlots.push({
    key: "date", conj: "OR", items: [{
      id: "date",
      label: `date ${fmtDay(filter.dateRange[0])}–${fmtDay(filter.dateRange[1])}`,
      onClear: () => setF({ dateRange: null }),
    }],
  });
  if (facets.videos && filter.videos.size > 0) chipSlots.push({
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
            options={sortOptions}
            value={filter.sort}
            onChange={(v) => setF({ sort: v })}
          />
        </FacetCard>
      </FacetSection>

      {(facets.kind || facets.reason) && (
        <FacetSection title="kind">
          {facets.kind && (
            <FacetCard
              label="kind" color={FACET.kind}
              selected={filter.kinds.size} total={kindRows.length}
            >
              <BarListFacet
                rows={kindRows} selected={filter.kinds}
                onToggle={(v) => toggleString("kinds", v)}
              />
            </FacetCard>
          )}
          {facets.reason && (
            <FacetCard
              label="cross-video match" color={FACET.crossVideo}
              selected={filter.reasons.size} total={reasonRows.length}
            >
              <BarListFacet
                rows={reasonRows} selected={filter.reasons}
                onToggle={(v) => toggleString("reasons", v)}
              />
            </FacetCard>
          )}
        </FacetSection>
      )}

      {(facets.sharedEntities || facets.similarity || facets.publishDate) && (
        <FacetSection title="magnitudes">
          {facets.sharedEntities && (
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
          )}
          {facets.similarity && (
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
          )}
          {facets.publishDate && (
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
          )}
        </FacetSection>
      )}

      {facets.entities && (
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
      )}

      {facets.videos && (
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
      )}
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
          onMutated={onMutated ?? (() => { /* read-only */ })}
        />
      ))}
      {sorted.length === 0 && emptyMessage && (
        <Typography variant="body2" sx={{
          color: "text.secondary", py: 4, textAlign: "center",
        }}>
          {emptyMessage}
        </Typography>
      )}
    </>
  );

  return (
    <FacetsPageOuter>
      <FacetsPageHeader
        title={title}
        matchCount={filtered.length}
        totalCount={rows.length}
        nounPlural={totalNoun}
        suffix={<GraphSeedsButton claimIds={graphSeeds} />}
        description={description}
      />
      <RailResultsLayout rail={rail} results={results} />
    </FacetsPageOuter>
  );
}
