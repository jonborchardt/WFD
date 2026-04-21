// Home page: compact faceted search.
//
// Layout: narrow filter rail on the left (about a third of the page),
// results table on the right. The rail grows from 1 → 2 → 3 columns
// as space allows.
//
// Filter kinds, top-to-bottom in the rail:
//   1. Cross-type search — basic "pick any entity" autocomplete.
//      Picking a result drops it into the correct facet's active slot.
//   2. Time facets (decade / year / month / week) — brushable
//      histograms, drag a range. time_of_day → small bar list.
//   3. Entity facets — grid of compact bar-list cards. Each card
//      supports co-occurrence: "+ and another {type}" adds a new
//      AND-slot so you can demand Person A AND Person B (rather than
//      the within-slot OR semantics of multiple picks in one slot).
//
// Filter state round-trips through the URL (`?person=person:a|person:b
// &person=person:c&year=year:2015`) so any filtered view is
// deep-linkable. Repeated keys = multiple AND-slots for that type.
// Within a single slot, entities are `|`-joined and combined with OR.
//
// Order of types is rational, not mention-count-based: time first
// (coarse → fine), then person / organization / location / event /
// thing / topic / misc, then anything else.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Typography, Chip, TextField, Button, IconButton, Autocomplete,
} from "@mui/material";
import {
  loadFacetData, topEntitiesForType,
  type FacetBundle, type Selection,
} from "../components/facets/duck";
import {
  BrushFacet, TIME_FACET_TYPES, axisLabel, timeValue,
} from "../components/facets/BrushFacet";
import {
  SimpleFacet, SIMPLE_FACET_TYPES,
} from "../components/facets/SimpleFacet";
import { FacetSection } from "../components/facets/FacetSection";
import {
  FilterChipStrip, type ChipSlot,
} from "../components/facets/FilterChipStrip";
import {
  FacetsPageHeader, FacetsPageOuter, RailResultsLayout,
} from "../components/facets/FacetsPageShell";
import { SimpleVideoTable } from "../components/SimpleVideoTable";
import { beginLoad } from "../lib/loading";
import { ENTITY_TYPE_COLOR } from "../components/catalog-columns";
import { EntityMenuButton } from "../components/EntityMenu";

const PER_TYPE_VISIBLE = 8;

const TIME_TYPES_IN_ORDER = [
  "decade", "year", "specific_month", "specific_week",
  "specific_date_time", "time_of_day",
];
const ENTITY_PRIORITY = [
  "person", "organization", "location",
  "event", "thing", "topic", "misc",
];

const TYPE_COLOR: Record<string, string> = {
  person: "#90caf9",
  organization: "#ce93d8",
  location: "#a5d6a7",
  event: "#ffb74d",
  thing: "#80deea",
  misc: "#80deea",
  time: "#bdbdbd",
};

type SlotMap = Record<string, Set<string>[]>;

interface AllOption {
  entityId: string;
  canonical: string;
  type: string;
  mentions: number;
}

function getSlots(map: SlotMap, type: string): Set<string>[] {
  return map[type] && map[type].length > 0 ? map[type] : [new Set<string>()];
}

function slotMapToSelection(map: SlotMap): Selection {
  const out: Selection = [];
  for (const [type, groups] of Object.entries(map)) {
    out.push({ type, groups });
  }
  return out;
}

function videosForSlots(
  bundle: FacetBundle,
  map: SlotMap,
): Set<string> {
  let active: Set<string> | null = null;
  for (const type of Object.keys(map)) {
    for (const group of map[type]) {
      if (group.size === 0) continue;
      const videos = new Set<string>();
      for (const eid of group) {
        const facts = bundle.factsByEntity.get(eid);
        if (!facts) continue;
        for (const f of facts) videos.add(f.videoId);
      }
      if (active === null) active = videos;
      else {
        const next = new Set<string>();
        for (const v of active) if (videos.has(v)) next.add(v);
        active = next;
      }
    }
  }
  return active ?? new Set(bundle.videoById.keys());
}

function parseSlotMapFromUrl(): SlotMap {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const m: SlotMap = {};
  const keys = new Set(params.keys());
  for (const key of keys) {
    const slots = params.getAll(key)
      .map((v) => new Set(v.split("|").filter(Boolean)))
      .filter((s) => s.size > 0);
    if (slots.length > 0) m[key] = slots;
  }
  return m;
}

function writeSlotMapToUrl(map: SlotMap) {
  const params = new URLSearchParams();
  for (const [type, slots] of Object.entries(map)) {
    for (const slot of slots) {
      if (slot.size === 0) continue;
      params.append(type, [...slot].join("|"));
    }
  }
  const qs = params.toString();
  const url = window.location.pathname + (qs ? "?" + qs : "");
  window.history.replaceState({}, "", url);
}

export function VideosPage() {
  const [bundle, setBundle] = useState<FacetBundle | null>(null);
  const [slotMap, setSlotMap] = useState<SlotMap>(() => parseSlotMapFromUrl());
  const [activeSlot, setActiveSlot] = useState<Record<string, number>>({});
  const [searchByType, setSearchByType] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const end = beginLoad();
    loadFacetData().then(setBundle).finally(end);
  }, []);

  // Skip the first effect run — slotMap is already initialized from
  // the URL, so writing it back immediately is a no-op that also
  // inflates the browser history with a replaceState call.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    writeSlotMapToUrl(slotMap);
  }, [slotMap]);

  const activeIds = useMemo(
    () => bundle ? videosForSlots(bundle, slotMap) : new Set<string>(),
    [bundle, slotMap],
  );

  const activeRows = useMemo(() => {
    if (!bundle) return [];
    return bundle.videos
      .filter((r) => activeIds.has(r.videoId))
      .sort((a, b) =>
        Date.parse(b.publishDate || "0") - Date.parse(a.publishDate || "0"),
      );
  }, [bundle, activeIds]);

  const selectionCompat = useMemo(
    () => slotMapToSelection(slotMap),
    [slotMap],
  );

  const allSearchOptions: AllOption[] = useMemo(() => {
    if (!bundle) return [];
    const out: AllOption[] = [];
    for (const meta of bundle.entities.values()) {
      const facts = bundle.factsByEntity.get(meta.id);
      if (!facts || facts.length === 0) continue;
      const mentions = facts.reduce((s, f) => s + f.count, 0);
      out.push({
        entityId: meta.id, canonical: meta.canonical,
        type: meta.type, mentions,
      });
    }
    out.sort((a, b) => b.mentions - a.mentions);
    return out;
  }, [bundle]);

  if (!bundle) return null;

  const present = new Set(bundle.typesInOrder);
  const timeTypes = TIME_TYPES_IN_ORDER.filter((t) => present.has(t));
  const timeSet = new Set(timeTypes);
  const priorityEntities = ENTITY_PRIORITY.filter((t) => present.has(t));
  const entityTypes = [
    ...priorityEntities,
    ...bundle.typesInOrder.filter(
      (t) => !timeSet.has(t) && !ENTITY_PRIORITY.includes(t),
    ),
  ];

  const toggle = (type: string, slotIdx: number, eid: string) => {
    setSlotMap((prev) => {
      const slots = getSlots(prev, type).map((s) => new Set(s));
      while (slots.length <= slotIdx) slots.push(new Set<string>());
      if (slots[slotIdx].has(eid)) slots[slotIdx].delete(eid);
      else slots[slotIdx].add(eid);
      while (slots.length > 1 && slots[slots.length - 1].size === 0) {
        slots.pop();
      }
      if (slots.length === 1 && slots[0].size === 0) {
        const next = { ...prev };
        delete next[type];
        return next;
      }
      return { ...prev, [type]: slots };
    });
  };

  const addSlot = (type: string) => {
    const nextIdx = getSlots(slotMap, type).length;
    setSlotMap((prev) => {
      const slots = getSlots(prev, type).map((s) => new Set(s));
      slots.push(new Set<string>());
      return { ...prev, [type]: slots };
    });
    setActiveSlot((a) => ({ ...a, [type]: nextIdx }));
  };

  const removeSlot = (type: string, slotIdx: number) => {
    setSlotMap((prev) => {
      const current = getSlots(prev, type);
      if (current.length <= 1) {
        const next = { ...prev };
        delete next[type];
        return next;
      }
      const slots = current
        .filter((_, i) => i !== slotIdx)
        .map((s) => new Set(s));
      return { ...prev, [type]: slots };
    });
    setActiveSlot((a) => {
      const v = a[type] ?? 0;
      if (v >= slotIdx) return { ...a, [type]: Math.max(0, v - 1) };
      return a;
    });
  };

  const setTimeSlot0 = (type: string, ids: Set<string>) => {
    setSlotMap((prev) => {
      if (ids.size === 0) {
        const next = { ...prev };
        delete next[type];
        return next;
      }
      const slots = getSlots(prev, type).map((s) => new Set(s));
      slots[0] = new Set(ids);
      return { ...prev, [type]: slots };
    });
  };

  const addViaSearch = (eid: string) => {
    const meta = bundle.entities.get(eid);
    if (!meta) return;
    const slotIdx = activeSlot[meta.type] ?? 0;
    toggle(meta.type, slotIdx, eid);
  };

  const clearAll = () => { setSlotMap({}); setActiveSlot({}); };

  interface FlatSlot {
    type: string;
    gi: number;
    items: { eid: string; canonical: string }[];
  }
  const chipSlots: FlatSlot[] = [];
  const chipTypeOrder = [...timeTypes, ...entityTypes];
  for (const type of chipTypeOrder) {
    const slots = slotMap[type];
    if (!slots) continue;
    slots.forEach((g, gi) => {
      if (g.size === 0) return;
      const items: { eid: string; canonical: string }[] = [];
      for (const eid of g) {
        const meta = bundle.entities.get(eid);
        if (!meta) continue;
        items.push({ eid, canonical: meta.canonical });
      }
      if (items.length > 0) chipSlots.push({ type, gi, items });
    });
  }

  const renderEntityCard = (type: string) => {
    const slots = getSlots(slotMap, type);
    const slotIdx = Math.min(activeSlot[type] ?? 0, slots.length - 1);
    const currentSlot = slots[slotIdx];

    // Scope top-N to everything selected except this slot, so
    // suggestions reflect the rest of the active filter.
    const scopeMap: SlotMap = {
      ...slotMap,
      [type]: slots.filter((_, i) => i !== slotIdx),
    };
    const scopedActive = videosForSlots(bundle, scopeMap);
    const q = (searchByType[type] || "").toLowerCase();
    // Always pull the full list — the header count needs to reflect
    // reality, and search has to match past the default visible slice.
    const { top } = topEntitiesForType(
      bundle, type, scopedActive, 1_000_000,
    );
    const filtered = q
      ? top.filter((r) => r.canonical.toLowerCase().includes(q))
      : top;
    const limit = showAll[type] ? 200 : PER_TYPE_VISIBLE;
    const visible = filtered.slice(0, limit);
    const max = top[0]?.total || 1;
    const selectedInType = slots.reduce((n, s) => n + s.size, 0);
    const hasMultipleSlots = slots.length > 1;

    const color = TYPE_COLOR[type] || "#90caf9";

    return (
      <Box key={type} sx={{
        border: 1, borderColor: "divider",
        borderLeft: 3, borderLeftColor: color,
        borderRadius: 1, p: 1, minWidth: 0,
      }}>
        <Box sx={{
          display: "flex", alignItems: "center", gap: 0.5, mb: 0.25,
        }}>
          <Box sx={{
            width: 8, height: 8, bgcolor: color,
            borderRadius: "50%", flexShrink: 0,
          }} />
          <Typography variant="caption" sx={{
            textTransform: "uppercase", color: "text.secondary",
            fontSize: 10, flexGrow: 1, lineHeight: 1.2,
          }}>
            {type}
          </Typography>
          {selectedInType > 0 && (
            <Chip
              size="small"
              label={selectedInType}
              color="primary"
              sx={{
                height: 14, fontSize: 9,
                "& .MuiChip-label": { px: 0.5 },
              }}
            />
          )}
          <Typography sx={{
            fontSize: 10, color: "text.secondary",
            fontVariantNumeric: "tabular-nums",
          }}>
            {top.length}
          </Typography>
        </Box>

        {hasMultipleSlots && (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 0.25,
            mb: 0.25, flexWrap: "wrap",
          }}>
            {slots.map((_, i) => {
              const isActive = i === slotIdx;
              return (
                <Box key={i} sx={{
                  display: "flex", alignItems: "center",
                  border: 1,
                  borderColor: isActive ? "primary.main" : "divider",
                  borderRadius: 0.5,
                  bgcolor: isActive ? "action.selected" : "transparent",
                  "&:hover": { borderColor: "primary.main" },
                }}>
                  <Box
                    onClick={() => setActiveSlot((a) => ({
                      ...a, [type]: i,
                    }))}
                    sx={{
                      fontSize: 10, px: 0.5, py: 0.125,
                      cursor: "pointer", lineHeight: 1.4,
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {i === 0 ? type : `AND #${i + 1}`}
                    {slots[i].size > 0 && (
                      <span style={{ color: "#888", marginLeft: 3 }}>
                        ({slots[i].size})
                      </span>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => removeSlot(type, i)}
                    sx={{ p: 0, width: 14, height: 14 }}
                  >
                    <span style={{ fontSize: 11, lineHeight: 1 }}>×</span>
                  </IconButton>
                </Box>
              );
            })}
          </Box>
        )}

        <TextField
          size="small"
          placeholder="search…"
          value={searchByType[type] || ""}
          onChange={(e) => setSearchByType((s) => ({
            ...s, [type]: e.target.value,
          }))}
          fullWidth
          sx={{
            mb: 0.25,
            "& .MuiInputBase-input": {
              fontSize: 11, py: 0.25, px: 0.5,
            },
          }}
        />
        <Box sx={{
          maxHeight: showAll[type] ? 280 : "none",
          overflow: showAll[type] ? "auto" : "visible",
        }}>
          {visible.map((r) => {
            const isSelected = currentSlot.has(r.entityId);
            return (
              <Box
                key={r.entityId}
                onClick={() => toggle(type, slotIdx, r.entityId)}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.5,
                  cursor: "pointer", py: 0.25,
                  borderRadius: 0.5, px: 0.5,
                  "&:hover": { bgcolor: "action.hover" },
                  bgcolor: isSelected ? "action.selected" : "transparent",
                }}
              >
                <Box sx={{
                  flex: 1, fontSize: 11, minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {r.canonical}
                </Box>
                <Box sx={{
                  width: 50, height: 6,
                  bgcolor: "action.disabledBackground",
                  borderRadius: 1, flexShrink: 0,
                }}>
                  <Box sx={{
                    height: "100%",
                    width: `${(r.total / max) * 100}%`,
                    bgcolor: isSelected ? "primary.main" : color,
                    borderRadius: 1,
                  }} />
                </Box>
                <Box sx={{
                  width: 28, fontSize: 10, color: "text.secondary",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {r.total}
                </Box>
                <Box
                  sx={{ width: 18, flexShrink: 0 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <EntityMenuButton
                    entity={{
                      key: r.entityId,
                      canonical: r.canonical,
                      label: type,
                    }}
                    where="/"
                  />
                </Box>
              </Box>
            );
          })}
          {visible.length === 0 && (
            <Typography sx={{
              fontSize: 10, color: "text.secondary", px: 0.5,
            }}>
              no matches
            </Typography>
          )}
        </Box>

        <Box sx={{
          display: "flex", gap: 0.5, mt: 0.25, flexWrap: "wrap",
        }}>
          {filtered.length > PER_TYPE_VISIBLE && (
            <Button
              size="small"
              onClick={() => setShowAll((s) => ({
                ...s, [type]: !s[type],
              }))}
              sx={{ fontSize: 10, py: 0, minHeight: 20, px: 0.5 }}
            >
              {showAll[type]
                ? "top 8"
                : `+${filtered.length - PER_TYPE_VISIBLE} more`}
            </Button>
          )}
          {currentSlot.size > 0 && (
            <Button
              size="small"
              onClick={() => addSlot(type)}
              sx={{ fontSize: 10, py: 0, minHeight: 20, px: 0.5 }}
            >
              + and another {type}
            </Button>
          )}
        </Box>
      </Box>
    );
  };

  const rail = (
    <>
        <Autocomplete
          options={allSearchOptions}
          getOptionLabel={(o) => o.canonical}
          value={null}
          blurOnSelect
          clearOnBlur
          size="small"
          onChange={(_, v) => { if (v) addViaSearch(v.entityId); }}
          filterOptions={(opts, state) => {
            const qv = state.inputValue.toLowerCase();
            if (!qv) return opts.slice(0, 50);
            return opts
              .filter((o) => o.canonical.toLowerCase().includes(qv))
              .slice(0, 50);
          }}
          renderOption={(props, option) => (
            <Box
              component="li"
              {...props}
              key={option.entityId}
              sx={{
                display: "flex", gap: 1,
                justifyContent: "space-between",
                fontSize: 12, py: 0.25,
              }}
            >
              <span>{option.canonical}</span>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <Chip
                  size="small"
                  label={option.type}
                  color={ENTITY_TYPE_COLOR[option.type] || "default"}
                  sx={{ height: 16, fontSize: 10 }}
                />
                <span style={{
                  color: "#999", fontVariantNumeric: "tabular-nums",
                }}>
                  {option.mentions.toLocaleString()}
                </span>
              </Box>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="search any person, place, org, topic…"
              size="small"
            />
          )}
          sx={{ mb: 1 }}
        />

        <FacetSection title="time">
          {timeTypes.map((type) => {
            const slots = getSlots(slotMap, type);
            const sel = slots[0] || new Set<string>();
            const isBrush = TIME_FACET_TYPES.has(type);
            const isSimple = SIMPLE_FACET_TYPES.has(type);
            const tcolor = TYPE_COLOR[type] || "#bdbdbd";
            if (!isBrush && !isSimple) return renderEntityCard(type);
            return (
              <Box key={type} sx={{
                border: 1, borderColor: "divider",
                borderLeft: 3, borderLeftColor: tcolor,
                borderRadius: 1, p: 1, minWidth: 0,
              }}>
                <Box sx={{
                  display: "flex", alignItems: "center", gap: 0.5,
                  mb: 0.25,
                }}>
                  <Box sx={{
                    width: 8, height: 8, bgcolor: tcolor,
                    borderRadius: "50%", flexShrink: 0,
                  }} />
                  <Typography variant="caption" sx={{
                    textTransform: "uppercase",
                    color: "text.secondary",
                    fontSize: 10, flexGrow: 1, lineHeight: 1.2,
                  }}>
                    {type}
                  </Typography>
                  {sel.size > 0 && (
                    <Chip
                      size="small"
                      label={sel.size}
                      color="primary"
                      sx={{
                        height: 14, fontSize: 9,
                        "& .MuiChip-label": { px: 0.5 },
                      }}
                    />
                  )}
                </Box>
                {isBrush ? (
                  <BrushFacet
                    type={type}
                    selection={selectionCompat}
                    bundle={bundle}
                    selected={sel}
                    onSetGroup={(ids) => setTimeSlot0(type, ids)}
                  />
                ) : (
                  <SimpleFacet
                    type={type}
                    selection={selectionCompat}
                    bundle={bundle}
                    selected={sel}
                    onToggle={(eid) => {
                      const next = new Set(sel);
                      if (next.has(eid)) next.delete(eid);
                      else next.add(eid);
                      setTimeSlot0(type, next);
                    }}
                  />
                )}
              </Box>
            );
          })}
        </FacetSection>

        <FacetSection title="entities">
          {entityTypes.map((type) => renderEntityCard(type))}
        </FacetSection>
    </>
  );

  const results = (
    <>
        <FilterChipStrip
          slots={chipSlots.map<ChipSlot>((slot) => {
            // Time brushes drop one entity id per year / decade /
            // week / month in range — rendering them as a long row
            // of per-year chips drowns the chip strip. Compress to a
            // single "start – end" chip; delete clears the whole slot.
            const isTimeBrush =
              TIME_FACET_TYPES.has(slot.type) && slot.items.length > 1;
            const color = ENTITY_TYPE_COLOR[slot.type];
            if (isTimeBrush) {
              const times = slot.items
                .map((c) => timeValue(slot.type, c.canonical))
                .filter((t): t is number => t !== null);
              const min = Math.min(...times);
              const max = Math.max(...times);
              return {
                key: `${slot.type}:${slot.gi}`,
                conj: "OR",
                color,
                items: [],
                compactLabel:
                  `${axisLabel(slot.type, min)} – ${axisLabel(slot.type, max)}`,
                compactTitle:
                  `${slot.items.length} ${slot.type} values in range`,
                onCompactClear: () => setTimeSlot0(slot.type, new Set()),
              };
            }
            return {
              key: `${slot.type}:${slot.gi}`,
              conj: "OR",
              color,
              items: slot.items.map((c) => ({
                id: c.eid,
                label: c.canonical,
                onClear: () => toggle(slot.type, slot.gi, c.eid),
              })),
            };
          })}
          onClearAll={chipSlots.length > 0 ? clearAll : undefined}
        />
        <SimpleVideoTable rows={activeRows} />
    </>
  );

  return (
    <FacetsPageOuter>
      <FacetsPageHeader
        title="Videos"
        matchCount={activeRows.length}
        totalCount={bundle.videos.length}
      />
      <RailResultsLayout rail={rail} results={results} />
    </FacetsPageOuter>
  );
}
