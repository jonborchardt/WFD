// Shared active-filter chip strip used by the videos / claims /
// contradictions pages. Input is a list of "slots", each slot being
// one facet's worth of selected values; the strip renders them so
// the user can see both the filters they've applied AND how they
// combine logically.
//
// Visual model:
//   - between slots: AND badge (all slots must match)
//   - within a slot with >1 items: dashed-border group, items joined
//     by the slot's per-slot conjunction badge (always OR today —
//     entity selections of the same type share a slot; entities of
//     different types end up in separate AND-joined slots)
//   - a slot with exactly 1 item renders as a plain chip (no box)
//   - a slot can opt into a "compact" single-chip view (e.g. a time
//     brush compressed into "2018 – 2024") by setting `compactLabel`
//     and `onCompactClear`
//
// Callers build the ChipSlot list themselves and pass it in — the
// component is presentation-only, no filter state knowledge.
//
// Chip coloring: pass a hex color on the slot and every chip in the
// slot paints with that accent (outlined border + text + delete-icon
// color). Matches the shared ENTITY_TYPE_COLOR palette used by the
// BarListFacet bars and FacetCard accents, so an "organization" chip
// in the strip reads the same color as the organization facet card.

import { Fragment } from "react";
import type { MouseEvent } from "react";
import { Box, Button, Chip, Tooltip } from "@mui/material";

export interface ChipItem {
  id: string;
  label: string;
  onClear: () => void;
  onClick?: (e: MouseEvent) => void;
  title?: string;
}

export interface ChipSlot {
  key: string;
  /** How items combine within this slot. Between slots is always AND. */
  conj: "AND" | "OR";
  items: ChipItem[];
  /** Hex accent applied to every chip in this slot (border + text). */
  color?: string;
  /** If set, render the slot as a single compact chip (time-range case). */
  compactLabel?: string;
  compactTitle?: string;
  onCompactClear?: () => void;
}

interface Props {
  slots: ChipSlot[];
  onClearAll?: () => void;
}

export function FilterChipStrip({ slots, onClearAll }: Props) {
  const visible = slots.filter((s) =>
    (s.compactLabel !== undefined) || s.items.length > 0,
  );
  if (visible.length === 0) return null;
  return (
    <Box sx={{
      py: 0.5, display: "flex", flexWrap: "wrap",
      alignItems: "center", gap: 0.5, mb: 2,
    }}>
      {visible.map((slot, slotIdx) => {
        const chipSx = colorChipSx(slot.color);
        return (
          <Fragment key={slot.key}>
            {slotIdx > 0 && <OpBadge op="AND" />}
            {slot.compactLabel !== undefined ? (
              <MaybeTooltip title={slot.compactTitle}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={slot.compactLabel}
                  onDelete={slot.onCompactClear}
                  sx={chipSx}
                />
              </MaybeTooltip>
            ) : slot.items.length > 1 ? (
              <Box sx={{
                display: "inline-flex", flexWrap: "wrap",
                alignItems: "center", rowGap: 0.5, columnGap: 0.5,
                px: 0.5, py: 0.25, border: 1,
                borderStyle: "dashed", borderColor: "divider",
                borderRadius: 1,
                maxWidth: "100%", minWidth: 0,
              }}>
                {slot.items.map((c, i) => (
                  <Fragment key={c.id}>
                    {i > 0 && <OpBadge op={slot.conj} />}
                    <MaybeTooltip title={c.title}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={c.label}
                        onClick={c.onClick}
                        onDelete={c.onClear}
                        sx={chipSx}
                      />
                    </MaybeTooltip>
                  </Fragment>
                ))}
              </Box>
            ) : (
              <MaybeTooltip title={slot.items[0].title}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={slot.items[0].label}
                  onClick={slot.items[0].onClick}
                  onDelete={slot.items[0].onClear}
                  sx={chipSx}
                />
              </MaybeTooltip>
            )}
          </Fragment>
        );
      })}
      {onClearAll && (
        <Button size="small" onClick={onClearAll} sx={{ ml: 1 }}>
          clear all
        </Button>
      )}
    </Box>
  );
}

// Wrap a child in a MUI Tooltip when the title is a non-empty string;
// otherwise pass through so absent titles don't render an empty bubble.
function MaybeTooltip({
  title,
  children,
}: {
  title?: string;
  children: React.ReactElement;
}) {
  if (!title) return children;
  return <Tooltip title={title} arrow disableInteractive>{children}</Tooltip>;
}

export function OpBadge({ op }: { op: "AND" | "OR" }) {
  return (
    <Box sx={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
      color: op === "AND" ? "primary.main" : "text.secondary",
      border: 1,
      borderColor: op === "AND" ? "primary.main" : "divider",
      borderRadius: 0.5, px: 0.5, py: 0.125,
      bgcolor: "action.hover", lineHeight: 1.4,
    }}>
      {op}
    </Box>
  );
}

// Outlined chip with a hex accent for border, label, and delete-icon
// color. Keeps the chip legible on either light or dark background
// (no filled bg) while matching the facet card's type accent.
function colorChipSx(color: string | undefined) {
  if (!color) return undefined;
  return {
    borderColor: color,
    color,
    "& .MuiChip-deleteIcon": { color, opacity: 0.6 },
    "& .MuiChip-deleteIcon:hover": { color, opacity: 1 },
  };
}
