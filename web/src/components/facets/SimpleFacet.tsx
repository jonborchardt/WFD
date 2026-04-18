// Minimal click-to-toggle bar list. No search, no co-occurrence slots.
// Used for small closed-set categorical facets like time_of_day, where
// there are only a handful of values and users never need to search or
// layer filters on top of each other.

import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import type { FacetBundle, Selection } from "./duck";
import { activeVideoIds, topEntitiesForType } from "./duck";

export const SIMPLE_FACET_TYPES: ReadonlySet<string> = new Set(["time_of_day"]);

// Stable left-to-right ordering for specific categorical types so bars
// don't shuffle by count. Types not listed fall back to count-desc.
const CHRONOLOGICAL_ORDER: Record<string, string[]> = {
  time_of_day: ["morning", "day", "evening", "night"],
};

interface Props {
  type: string;
  selection: Selection;
  bundle: FacetBundle;
  selected: Set<string>;
  onToggle: (entityId: string) => void;
}

export function SimpleFacet({ type, selection, bundle, selected, onToggle }: Props) {
  // Scope to every other facet selection except this type, matching
  // the behaviour of the brush and column variants so the displayed
  // counts reflect the rest of the active filter.
  const scoped = useMemo(
    () => activeVideoIds(bundle, selection.filter((e) => e.type !== type)),
    [bundle, selection, type],
  );
  const { top } = useMemo(
    () => topEntitiesForType(bundle, type, scoped, 1_000_000),
    [bundle, type, scoped],
  );

  const rows = useMemo(() => {
    const order = CHRONOLOGICAL_ORDER[type];
    if (!order) return top;
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...top].sort((a, b) => {
      const ra = rank.get(a.canonical) ?? 999;
      const rb = rank.get(b.canonical) ?? 999;
      return ra - rb;
    });
  }, [top, type]);

  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;

  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontSize: 10 }}>
        no {type} data in the current filter
      </Typography>
    );
  }

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 0.5, p: 0.5 }}>
      {rows.map((r) => {
        const width = Math.max(2, Math.round((r.total / maxTotal) * 100));
        const isSelected = selected.has(r.entityId);
        return (
          <Box
            key={r.entityId}
            onClick={() => onToggle(r.entityId)}
            sx={{
              display: "flex", alignItems: "center", gap: 0.75, px: 0.5, py: 0,
              cursor: "pointer", borderRadius: 0.5,
              bgcolor: isSelected ? "action.selected" : "transparent",
              "&:hover": { bgcolor: "action.hover" },
              minHeight: 18,
            }}
          >
            <Box sx={{ width: 80, minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, lineHeight: 1.2 }}>
              {r.canonical}
            </Box>
            <Box sx={{ flexGrow: 1, height: 10, bgcolor: "action.disabledBackground", borderRadius: 0.5, position: "relative" }}>
              <Box sx={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: width + "%",
                bgcolor: isSelected ? "primary.main" : "#90caf9",
                borderRadius: 0.5,
              }} />
            </Box>
            <Box sx={{ width: 40, textAlign: "right", fontSize: 10, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
              {r.total.toLocaleString()}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
