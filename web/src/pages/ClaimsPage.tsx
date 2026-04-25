// Faceted claims browser. Rail on the left groups cards into
// semantic sections (sort, claim type, magnitudes, flags, entities,
// video); results on the right. Mirrors the home-page rail idiom.
//
// Filter state round-trips through the URL so any filtered + sorted
// view is deep-linkable.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, TextField, Typography,
} from "@mui/material";
import { PageLoading } from "../components/PageLoading";
import { ClaimResultRow } from "../components/ClaimResultRow";
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
  binUnitInterval, loadClaimsBundle, truthValue,
  type ClaimsBundle,
} from "../components/facets/claims-duck";
import {
  ENTITY_PRIORITY, ENTITY_TYPE_COLOR, dateRangeStr,
  fmtDay, parseDateRange, parseRange, rangeStr, splitEntityKey,
} from "../lib/facet-helpers";
import { matchesTopic } from "../lib/claim-search";
import { beginLoad } from "../lib/loading";
import { colors } from "../theme";
import type { ClaimsIndexEntry } from "../types";

const FACET = colors.facet;


const SORT_OPTIONS: SortOption[] = [
  { value: "certain", label: "most certain",
    hint: "truth furthest from 0.5" },
  { value: "uncertain", label: "most uncertain",
    hint: "truth closest to 0.5" },
  { value: "contradicted", label: "most contradicted",
    hint: "by contradiction count" },
  { value: "cited", label: "most cited",
    hint: "highest incoming dep count" },
  { value: "conf-high", label: "highest confidence" },
  { value: "conf-low", label: "lowest confidence" },
];

// Per-value tooltip definitions. Each row in a BarListFacet has an
// optional `title` that surfaces as the native hover tooltip; these
// maps are the source of truth for what each categorical value means.
const KIND_TITLES: Record<string, string> = {
  empirical: "Could be checked against the real world — something you could in theory measure or prove.",
  historical: "A claim about a past event: what happened, when, to whom.",
  speculative: "Goes past what the evidence shows — guesses, predictions, \"what if\" thinking.",
  opinion: "A judgment call about what's good, right, or worthwhile.",
  definitional: "A claim about what a word means, or where the line between two categories should go.",
};
const STANCE_TITLES: Record<string, string> = {
  asserts: "The host is saying this is true.",
  denies: "The host brings it up to push back on it (\"some people say X, but…\").",
  uncertain: "The host isn't taking a side on this one.",
  steelman: "The host lays out the strongest version of an idea he doesn't necessarily agree with, so it gets a fair hearing.",
  __none__: "No stance was recorded on this claim.",
};
const SOURCE_TITLES: Record<string, string> = {
  direct: "The host gave his verdict on this claim directly in the episode.",
  derived: "The truth score was worked out from other claims that back this up or push against it.",
  override: "Someone reviewing the site pinned this claim's truth score by hand.",
  uncalibrated: "No signal either way — we have nothing to judge this claim on yet.",
};
const VERDICT_TITLES: Record<string, string> = {
  yes: "The claim shows up in a part of the episode where the host is giving his verdict — a strong signal for the truth score.",
  no: "The claim isn't in a verdict segment; any truth score came from the evidence, not a direct host rating.",
};
const CONTRADICTED_TITLES: Record<string, string> = {
  yes: "At least one other claim on the site contradicts this one.",
  no: "No contradictions against this claim were found.",
};
const HASIN_TITLES: Record<string, string> = {
  yes: "At least one other claim links to this one (backs it up, contradicts it, leans on it, or adds to it).",
  no: "Nothing else on the site links to this claim.",
};
const HASOUT_TITLES: Record<string, string> = {
  yes: "This claim links out to other claims — it backs them up, contradicts them, leans on them, or adds to them.",
  no: "This claim stands alone; it doesn't link to any other claims.",
};

const KIND_ORDER = [
  "empirical", "historical", "speculative", "opinion", "definitional",
];
const STANCE_ORDER = ["asserts", "denies", "uncertain", "steelman"];
const SOURCE_ORDER = ["direct", "derived", "override", "uncalibrated"];

const PER_TYPE_VISIBLE = 8;

// ── filter state ─────────────────────────────────────────────────
type YesNo = "yes" | "no";

interface FilterState {
  q: string;
  kinds: Set<string>;
  stances: Set<string>;             // includes "__none__" sentinel
  sources: Set<string>;
  tags: Set<string>;
  truthRange: [number, number] | null;
  confRange: [number, number] | null;
  dateRange: [number, number] | null;
  verdict: Set<YesNo>;              // empty = any
  contradicted: Set<YesNo>;
  hasIn: Set<YesNo>;
  hasOut: Set<YesNo>;
  entities: Set<string>;            // AND across selected
  videos: Set<string>;
  sort: string;
}

// Every set-valued key on FilterState. Used by helpers that iterate
// over "all the set facets" without special-casing each one.
const STRING_SET_KEYS = [
  "kinds", "stances", "sources", "tags", "entities", "videos",
] as const;
type StringSetKey = (typeof STRING_SET_KEYS)[number];
const BOOL_SET_KEYS = [
  "verdict", "contradicted", "hasIn", "hasOut",
] as const;
type BoolSetKey = (typeof BOOL_SET_KEYS)[number];

const EMPTY_FILTER: FilterState = {
  q: "",
  kinds: new Set(),
  stances: new Set(),
  sources: new Set(),
  tags: new Set(),
  truthRange: null,
  confRange: null,
  dateRange: null,
  verdict: new Set(),
  contradicted: new Set(),
  hasIn: new Set(),
  hasOut: new Set(),
  entities: new Set(),
  videos: new Set(),
  sort: "certain",
};

function parseFiltersFromUrl(): FilterState {
  if (typeof window === "undefined") return { ...EMPTY_FILTER };
  const p = new URLSearchParams(window.location.search);
  const setOf = (k: string) => new Set(
    (p.get(k) || "").split(",").filter(Boolean),
  );
  const boolSet = (k: string): Set<YesNo> => {
    const out = new Set<YesNo>();
    for (const v of (p.get(k) || "").split(",").filter(Boolean)) {
      if (v === "yes" || v === "no") out.add(v);
    }
    return out;
  };
  return {
    q: p.get("q") || "",
    kinds: setOf("kind"),
    stances: setOf("stance"),
    sources: setOf("src"),
    tags: setOf("tag"),
    truthRange: parseRange(p.get("truth")),
    confRange: parseRange(p.get("conf")),
    dateRange: parseDateRange(p.get("date")),
    verdict: boolSet("verdict"),
    contradicted: boolSet("cx"),
    hasIn: boolSet("depin"),
    hasOut: boolSet("depout"),
    entities: setOf("entity"),
    videos: setOf("video"),
    sort: p.get("sort") || "certain",
  };
}

function writeFiltersToUrl(s: FilterState) {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  const setParam = (k: string, v: Set<string>) => {
    if (v.size > 0) p.set(k, [...v].join(","));
  };
  setParam("kind", s.kinds);
  setParam("stance", s.stances);
  setParam("src", s.sources);
  setParam("tag", s.tags);
  if (s.truthRange) p.set("truth", rangeStr(s.truthRange));
  if (s.confRange) p.set("conf", rangeStr(s.confRange));
  if (s.dateRange) p.set("date", dateRangeStr(s.dateRange));
  setParam("verdict", s.verdict);
  setParam("cx", s.contradicted);
  setParam("depin", s.hasIn);
  setParam("depout", s.hasOut);
  setParam("entity", s.entities);
  setParam("video", s.videos);
  if (s.sort !== "certain") p.set("sort", s.sort);
  const qs = p.toString();
  window.history.replaceState({}, "",
    window.location.pathname + (qs ? "?" + qs : ""));
}

// ── filter application ───────────────────────────────────────────
function passes(
  c: ClaimsIndexEntry, s: FilterState, bundle: ClaimsBundle,
): boolean {
  if (s.q.trim()) {
    const q = s.q.trim().toLowerCase();
    if (!c.text.toLowerCase().includes(q) && !matchesTopic(c, s.q)) return false;
  }
  if (s.kinds.size > 0 && !s.kinds.has(c.kind)) return false;
  if (s.stances.size > 0 && !s.stances.has(c.hostStance ?? "__none__")) return false;
  if (s.sources.size > 0 && !s.sources.has(c.truthSource)) return false;
  if (s.tags.size > 0) {
    const ct = c.tags ?? [];
    let any = false;
    for (const t of s.tags) if (ct.includes(t)) { any = true; break; }
    if (!any) return false;
  }
  if (s.truthRange) {
    const t = truthValue(c);
    if (t === null || t < s.truthRange[0] || t > s.truthRange[1]) return false;
  }
  if (s.confRange) {
    const cv = c.confidence;
    if (cv == null || cv < s.confRange[0] || cv > s.confRange[1]) return false;
  }
  if (s.dateRange) {
    const ms = bundle.videosById.get(c.videoId)?.publishMs ?? null;
    if (ms === null || ms < s.dateRange[0] || ms > s.dateRange[1]) return false;
  }
  if (s.verdict.size > 0 && !s.verdict.has(c.inVerdictSection ? "yes" : "no")) return false;
  if (s.contradicted.size > 0) {
    const has = (bundle.contradictionCount.get(c.id) ?? 0) > 0;
    if (!s.contradicted.has(has ? "yes" : "no")) return false;
  }
  if (s.hasIn.size > 0) {
    const has = (bundle.depCounts.get(c.id)?.in ?? 0) > 0;
    if (!s.hasIn.has(has ? "yes" : "no")) return false;
  }
  if (s.hasOut.size > 0) {
    const has = (bundle.depCounts.get(c.id)?.out ?? 0) > 0;
    if (!s.hasOut.has(has ? "yes" : "no")) return false;
  }
  if (s.videos.size > 0 && !s.videos.has(c.videoId)) return false;
  if (s.entities.size > 0) {
    // Within one entity type: OR (pick any of these people). Across
    // entity types: AND (this person AND in this location). Matches
    // how the chip strip groups selections visually.
    const ce = new Set(c.entities);
    const byType = new Map<string, string[]>();
    for (const e of s.entities) {
      const t = splitEntityKey(e).type;
      const arr = byType.get(t) ?? [];
      arr.push(e);
      byType.set(t, arr);
    }
    for (const values of byType.values()) {
      let any = false;
      for (const v of values) if (ce.has(v)) { any = true; break; }
      if (!any) return false;
    }
  }
  return true;
}

// Apply every filter except one, so facet counts reflect the rest
// of the active filter. Mirrors the home page's scoped-count pattern.
function filterExcept(
  claims: ClaimsIndexEntry[], s: FilterState, bundle: ClaimsBundle,
  exclude: keyof FilterState,
): ClaimsIndexEntry[] {
  const stripped: FilterState = { ...s };
  switch (exclude) {
    case "kinds": stripped.kinds = new Set(); break;
    case "stances": stripped.stances = new Set(); break;
    case "sources": stripped.sources = new Set(); break;
    case "tags": stripped.tags = new Set(); break;
    case "truthRange": stripped.truthRange = null; break;
    case "confRange": stripped.confRange = null; break;
    case "dateRange": stripped.dateRange = null; break;
    case "verdict": stripped.verdict = new Set(); break;
    case "contradicted": stripped.contradicted = new Set(); break;
    case "hasIn": stripped.hasIn = new Set(); break;
    case "hasOut": stripped.hasOut = new Set(); break;
    case "entities": stripped.entities = new Set(); break;
    case "videos": stripped.videos = new Set(); break;
    case "q": stripped.q = ""; break;
  }
  return claims.filter((c) => passes(c, stripped, bundle));
}

// ── the page ─────────────────────────────────────────────────────
export function ClaimsPage() {
  const nav = useNavigate();
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
  const [filter, setFilter] = useState<FilterState>(() => parseFiltersFromUrl());
  const [entitySearch, setEntitySearch] = useState<Record<string, string>>({});
  const [videoSearch, setVideoSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);
  const [showAllByType, setShowAllByType] =
    useState<Record<string, boolean>>({});

  useEffect(() => {
    const end = beginLoad();
    loadClaimsBundle().then(setBundle).finally(end);
  }, []);

  // Skip the first effect run — filter is initialized from the URL,
  // so writing it back immediately is a no-op that inflates history.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    writeFiltersToUrl(filter);
  }, [filter]);

  const setF = (p: Partial<FilterState>) => setFilter((f) => ({ ...f, ...p }));
  const toggleString = (key: StringSetKey, value: string) => {
    setFilter((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });
  };
  const toggleBool = (key: BoolSetKey, value: YesNo) => {
    setFilter((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });
  };
  const clearAll = () => setFilter({ ...EMPTY_FILTER });

  const filtered = useMemo(() => {
    if (!bundle) return [];
    return bundle.claims.filter((c) => passes(c, filter, bundle));
  }, [bundle, filter]);

  const sorted = useMemo(() => {
    if (!bundle) return [];
    const rows = [...filtered];
    switch (filter.sort) {
      case "certain":
        rows.sort((a, b) =>
          Math.abs((truthValue(b) ?? 0.5) - 0.5)
          - Math.abs((truthValue(a) ?? 0.5) - 0.5));
        break;
      case "uncertain":
        rows.sort((a, b) =>
          Math.abs((truthValue(a) ?? 0.5) - 0.5)
          - Math.abs((truthValue(b) ?? 0.5) - 0.5));
        break;
      case "contradicted":
        rows.sort((a, b) =>
          (bundle.contradictionCount.get(b.id) ?? 0)
          - (bundle.contradictionCount.get(a.id) ?? 0));
        break;
      case "cited":
        rows.sort((a, b) =>
          (bundle.depCounts.get(b.id)?.in ?? 0)
          - (bundle.depCounts.get(a.id)?.in ?? 0));
        break;
      case "conf-high":
        rows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        break;
      case "conf-low":
        rows.sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
        break;
    }
    return rows;
  }, [filtered, filter.sort, bundle]);

  if (!bundle) {
    return <PageLoading
      label="loading claims…"
      hint="fetching claims-index + contradictions + dependency-graph"
    />;
  }

  // ── per-facet counts (each scoped to "all other filters") ──────
  const kindRows = makeCountRows(
    KIND_ORDER.map((k) => [k, k, KIND_TITLES[k]] as const),
    filterExcept(bundle.claims, filter, bundle, "kinds"),
    (c) => c.kind,
  );
  const stanceRows = makeCountRows(
    [
      ...STANCE_ORDER.map((s) => [s, s, STANCE_TITLES[s]] as const),
      ["__none__", "(none)", STANCE_TITLES.__none__] as const,
    ],
    filterExcept(bundle.claims, filter, bundle, "stances"),
    (c) => c.hostStance ?? "__none__",
  );
  const sourceRows = makeCountRows(
    SOURCE_ORDER.map((s) => [s, s, SOURCE_TITLES[s]] as const),
    filterExcept(bundle.claims, filter, bundle, "sources"),
    (c) => c.truthSource,
  );
  const tagScope = filterExcept(bundle.claims, filter, bundle, "tags");
  const tagCounts = new Map<string, number>();
  for (const c of tagScope) {
    for (const t of (c.tags ?? [])) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const tagRowsAll: BarRow[] = [...tagCounts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .filter((r) => !tagSearch || r.label.toLowerCase().includes(tagSearch.toLowerCase()))
    .sort((a, b) => b.count - a.count);

  const verdictRows = makeCountRows(
    [
      ["yes", "host gave a verdict", VERDICT_TITLES.yes],
      ["no", "no host verdict", VERDICT_TITLES.no],
    ],
    filterExcept(bundle.claims, filter, bundle, "verdict"),
    (c) => c.inVerdictSection ? "yes" : "no",
  );
  const contradictedRows = makeCountRows(
    [
      ["yes", "contradicted", CONTRADICTED_TITLES.yes],
      ["no", "none", CONTRADICTED_TITLES.no],
    ],
    filterExcept(bundle.claims, filter, bundle, "contradicted"),
    (c) => (bundle.contradictionCount.get(c.id) ?? 0) > 0 ? "yes" : "no",
  );
  const hasInRows = makeCountRows(
    [
      ["yes", "other claims link to it", HASIN_TITLES.yes],
      ["no", "none", HASIN_TITLES.no],
    ],
    filterExcept(bundle.claims, filter, bundle, "hasIn"),
    (c) => (bundle.depCounts.get(c.id)?.in ?? 0) > 0 ? "yes" : "no",
  );
  const hasOutRows = makeCountRows(
    [
      ["yes", "links to other claims", HASOUT_TITLES.yes],
      ["no", "none", HASOUT_TITLES.no],
    ],
    filterExcept(bundle.claims, filter, bundle, "hasOut"),
    (c) => (bundle.depCounts.get(c.id)?.out ?? 0) > 0 ? "yes" : "no",
  );

  const truthScope = filterExcept(bundle.claims, filter, bundle, "truthRange");
  const confScope = filterExcept(bundle.claims, filter, bundle, "confRange");
  const dateScope = filterExcept(bundle.claims, filter, bundle, "dateRange");
  const videoScope = filterExcept(bundle.claims, filter, bundle, "videos");

  const truthBins = binUnitInterval(truthScope.map(truthValue), 0.05);
  const confBins = binUnitInterval(confScope.map((c) => c.confidence), 0.05);
  const dateTimestamps: number[] = [];
  for (const c of dateScope) {
    const ms = bundle.videosById.get(c.videoId)?.publishMs;
    if (ms != null) dateTimestamps.push(ms);
  }

  const entityByType = buildEntityBucketsByType(
    bundle.claims,
    filter.entities,
    (type) => {
      const stripped = stripEntityType(filter, type);
      return bundle.claims.filter((c) => passes(c, stripped, bundle));
    },
    (c) => c.entities,
  );
  const orderedTypes = [
    ...ENTITY_PRIORITY.filter((t) => entityByType.has(t)),
    ...[...entityByType.keys()].filter((t) => !ENTITY_PRIORITY.includes(t)),
  ];

  // videoId is the stable selection id; label is the truncated title,
  // with the full title on hover.
  const videoCounts = new Map<string, number>();
  for (const c of videoScope) {
    videoCounts.set(c.videoId, (videoCounts.get(c.videoId) ?? 0) + 1);
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

  // Active-filter chip strip, one slot per facet. Within-facet:
  // entities are AND (every selected key must be on the claim); all
  // other multi-value facets are OR. Between-facet: always AND.
  const chipSlots: ChipSlot[] = [];
  if (filter.q) chipSlots.push({
    key: "q", conj: "OR",
    items: [{
      id: "q", label: `text: ${filter.q}`,
      onClear: () => setF({ q: "" }),
    }],
  });
  for (const key of STRING_SET_KEYS) {
    if (key === "videos") continue; // title resolution handled below
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
  for (const key of BOOL_SET_KEYS) {
    const values = [...filter[key]];
    if (values.length === 0) continue;
    chipSlots.push({
      key, conj: "OR",
      items: values.map((v) => ({
        id: v,
        label: BOOL_CHIP_LABEL[key][v],
        onClear: () => toggleBool(key, v),
      })),
    });
  }
  if (filter.truthRange) chipSlots.push({
    key: "truth", conj: "OR", items: [{
      id: "truth",
      label: `truth ${filter.truthRange[0].toFixed(2)}–${filter.truthRange[1].toFixed(2)}`,
      onClear: () => setF({ truthRange: null }),
    }],
  });
  if (filter.confRange) chipSlots.push({
    key: "conf", conj: "OR", items: [{
      id: "conf",
      label: `conf ${filter.confRange[0].toFixed(2)}–${filter.confRange[1].toFixed(2)}`,
      onClear: () => setF({ confRange: null }),
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

  const rail = (
    <>
      <DebouncedSearchField
        value={filter.q}
        onCommit={(v) => setF({ q: v })}
        placeholder="search claim text, entities, kind…"
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

          <FacetSection title="claim type">
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
              label="host stance" color={FACET.hostStance}
              selected={filter.stances.size} total={stanceRows.length}
            >
              <BarListFacet
                rows={stanceRows} selected={filter.stances}
                onToggle={(v) => toggleString("stances", v)}
              />
            </FacetCard>
            <FacetCard
              label="truth source" color={FACET.truthSource}
              selected={filter.sources.size} total={sourceRows.length}
            >
              <BarListFacet
                rows={sourceRows} selected={filter.sources}
                onToggle={(v) => toggleString("sources", v)}
              />
            </FacetCard>
          </FacetSection>

          <FacetSection title="scores">
            <FacetCard
              label="truth range" color={FACET.truthRange}
              selected={filter.truthRange ? 1 : 0}
            >
              <NumericRangeFacet
                bins={truthBins} domain={[0, 1]}
                selected={filter.truthRange}
                onChange={(r) => setF({ truthRange: r })}
              />
            </FacetCard>
            <FacetCard
              label="confidence" color={FACET.confidence}
              selected={filter.confRange ? 1 : 0}
            >
              <NumericRangeFacet
                bins={confBins} domain={[0, 1]}
                selected={filter.confRange}
                onChange={(r) => setF({ confRange: r })}
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

          <FacetSection title="flags">
            <FacetCard
              label="verdict" color={FACET.verdict}
              selected={filter.verdict.size} total={2}
            >
              <BarListFacet
                rows={verdictRows}
                selected={filter.verdict as Set<string>}
                onToggle={(v) => toggleBool("verdict", v as YesNo)}
              />
            </FacetCard>
            <FacetCard
              label="contradictions" color={FACET.contradictions}
              selected={filter.contradicted.size} total={2}
            >
              <BarListFacet
                rows={contradictedRows}
                selected={filter.contradicted as Set<string>}
                onToggle={(v) => toggleBool("contradicted", v as YesNo)}
              />
            </FacetCard>
            <FacetCard
              label="linked from" color={FACET.citedBy}
              selected={filter.hasIn.size} total={2}
            >
              <BarListFacet
                rows={hasInRows}
                selected={filter.hasIn as Set<string>}
                onToggle={(v) => toggleBool("hasIn", v as YesNo)}
              />
            </FacetCard>
            <FacetCard
              label="links out to" color={FACET.cites}
              selected={filter.hasOut.size} total={2}
            >
              <BarListFacet
                rows={hasOutRows}
                selected={filter.hasOut as Set<string>}
                onToggle={(v) => toggleBool("hasOut", v as YesNo)}
              />
            </FacetCard>
          </FacetSection>

          <FacetSection title="tags">
            <FacetCard
              label="tag" color={FACET.accent}
              selected={filter.tags.size} total={tagCounts.size}
            >
              <TextField
                size="small"
                placeholder="search…"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                fullWidth
                sx={compactInputSx}
              />
              <BarListFacet
                rows={tagRowsAll.slice(0, showAllTags ? 200 : PER_TYPE_VISIBLE)}
                selected={filter.tags}
                onToggle={(v) => toggleString("tags", v)}
              />
              {tagRowsAll.length > PER_TYPE_VISIBLE && (
                <Button
                  size="small"
                  onClick={() => setShowAllTags((v) => !v)}
                  sx={{ fontSize: 10, py: 0, minHeight: 20, px: 0.5 }}
                >
                  {showAllTags
                    ? "top 8"
                    : `+${tagRowsAll.length - PER_TYPE_VISIBLE} more`}
                </Button>
              )}
            </FacetCard>
          </FacetSection>

          <FacetSection title="entities">
            {orderedTypes.map((type) => {
              const bucket = entityByType.get(type)!;
              const color = ENTITY_TYPE_COLOR[type] || FACET.accent;
              const selectedInType = [...filter.entities]
                .filter((k) => splitEntityKey(k).type === type).length;
              // Bucket empty → no search, no "+ more", just a note.
              // The card itself stays in place so the rail doesn't
              // reflow with every filter tweak.
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
      {sorted.slice(0, 200).map((c) => (
        <ClaimResultRow
          key={c.id}
          claim={c}
          nav={nav}
          bundle={bundle}
        />
      ))}
    </>
  );

  return (
    <FacetsPageOuter>
      <FacetsPageHeader
        title="Claims"
        matchCount={filtered.length}
        totalCount={bundle.claims.length}
        suffix={<GraphSeedsButton claimIds={sorted.map((c) => c.id)} />}
        description="The big points the host makes in each episode — the kind of thing you could argue for or against. Each one has a truth score, links to other claims it leans on or conflicts with, and a jump back to the spot in the transcript where it was said."
      />
      <RailResultsLayout rail={rail} results={results} />
    </FacetsPageOuter>
  );
}

// ── small building blocks ────────────────────────────────────────
const compactInputSx = {
  mb: 0.25,
  "& .MuiInputBase-input": { fontSize: 11, py: 0.25, px: 0.5 },
};

const STRING_KEY_LABEL: Record<StringSetKey, string> = {
  kinds: "kind",
  stances: "stance",
  sources: "source",
  tags: "tag",
  entities: "entity",
  videos: "video",
};

const BOOL_CHIP_LABEL: Record<BoolSetKey, Record<YesNo, string>> = {
  verdict:       { yes: "host gave a verdict",        no: "no host verdict" },
  contradicted:  { yes: "contradicted",                no: "no contradictions" },
  hasIn:         { yes: "other claims link to it",     no: "nothing links to it" },
  hasOut:        { yes: "links to other claims",       no: "stands alone" },
};

// Build pre-sorted BarRows with per-bucket counts from a projection.
// A third tuple element, when present, becomes the BarRow `title` — the
// native hover tooltip BarListFacet renders on each row.
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

