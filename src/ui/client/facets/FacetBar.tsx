// Single bar chart for one entity-type facet slot.
//
// Props are deliberately minimal — the slot is dumb: it gets pre-sorted rows
// and a selection set, and just renders. The parent (FacetGroup) owns the
// math. Keeping this component thin makes it easy to swap out the bar
// rendering for something fancier later.

import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import type { FacetRow } from "./duck.js";

const TYPE_COLOR_HEX: Record<string, string> = {
  person: "#90caf9",
  organization: "#ce93d8",
  location: "#a5d6a7",
  event: "#ffb74d",
  thing: "#80deea",
  misc: "#80deea",
  time: "#bdbdbd",
};

interface BarProps {
  row: FacetRow;
  type: string;
  selected: boolean;
  scale: number;
  onClick: () => void;
}

function Bar({ row, selected, scale, onClick, type }: BarProps) {
  const width = scale > 0 ? Math.max(2, Math.round((row.total / scale) * 100)) : 0;
  const hex = TYPE_COLOR_HEX[type] || "#90caf9";
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.25,
        cursor: "pointer", borderRadius: 1,
        bgcolor: selected ? "action.selected" : "transparent",
        "&:hover": { bgcolor: "action.hover" },
        opacity: row.total === 0 && !selected ? 0.5 : 1,
      }}
    >
      <Box sx={{ width: 140, minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
        {row.canonical}
      </Box>
      <Box sx={{ flexGrow: 1, height: 14, bgcolor: "action.disabledBackground", borderRadius: 0.5, position: "relative" }}>
        <Box sx={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: width + "%",
          bgcolor: selected ? "primary.main" : hex,
          borderRadius: 0.5,
        }} />
      </Box>
      <Box sx={{ width: 48, textAlign: "right", fontSize: 11, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
        {row.total.toLocaleString()}
      </Box>
    </Box>
  );
}

interface FacetBarProps {
  title: string;
  type: string;
  top: FacetRow[];
  pinned: FacetRow[];
  selected: Set<string>;
  maxTotal: number;
  onToggle: (entityId: string) => void;
  onRemove: () => void;
  removable: boolean;
}

export function FacetBar({ title, type, top, pinned, selected, maxTotal, onToggle, onRemove, removable }: FacetBarProps) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, width: 320, minWidth: 320 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <Typography variant="caption" sx={{ flexGrow: 1, textTransform: "uppercase", color: "text.secondary" }}>{title}</Typography>
        {removable && (
          <Tooltip title="remove this facet">
            <IconButton size="small" onClick={onRemove} sx={{ p: 0.25 }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {pinned.length > 0 && (
        <Box sx={{ borderBottom: 1, borderColor: "divider", pb: 0.5, mb: 0.5 }}>
          {pinned.map((r) => (
            <Bar key={r.entityId} row={r} type={type} selected={selected.has(r.entityId)} scale={maxTotal} onClick={() => onToggle(r.entityId)} />
          ))}
        </Box>
      )}
      {top.length === 0 && pinned.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>no {type} entities in current filter</Typography>
      )}
      {top.map((r) => (
        <Bar key={r.entityId} row={r} type={type} selected={selected.has(r.entityId)} scale={maxTotal} onClick={() => onToggle(r.entityId)} />
      ))}
    </Box>
  );
}
