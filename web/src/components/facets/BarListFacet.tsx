// Generic click-to-toggle bar list. Each row shows a label, a
// proportional bar, and the raw count. Selection is a Set of ids and
// clicking a row flips membership.
//
// Where SimpleFacet is wired into the home-page entity bundle, this
// one takes pre-built rows so it can back any categorical dimension
// (kind, host stance, truth source, verdict-yes-no, …).

import { Box, Tooltip, Typography } from "@mui/material";
import { colors } from "../../theme";

export interface BarRow {
  id: string;
  label: string;
  count: number;
  // Full-length text shown as a native tooltip on hover. Facet callers
  // that truncate a long label (video titles, for example) pass the
  // original string here so hover reveals it.
  title?: string;
}

interface Props {
  rows: BarRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  color?: string;
  emptyText?: string;
  maxRows?: number;
}

export function BarListFacet({
  rows,
  selected,
  onToggle,
  color = colors.facet.accent,
  emptyText = "no options",
  maxRows,
}: Props) {
  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{
        px: 0.5, fontSize: 10,
      }}>
        {emptyText}
      </Typography>
    );
  }
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <Box>
      {visible.map((r) => {
        const width = Math.max(2, Math.round((r.count / max) * 100));
        const isSelected = selected.has(r.id);
        // Tooltip anchors on the *text* itself, not on the surrounding
        // flex cell. The outer slot is flex:1 so the row stays aligned,
        // but the inline-block span shrinks to the actual word width —
        // so hover only fires when the cursor is over the letters, not
        // the empty space to the right of a short label.
        const textSpan = (
          <Box
            component="span"
            sx={{
              display: "inline-block",
              maxWidth: "100%",
              verticalAlign: "bottom",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              ...(r.title ? {
                textDecoration: "underline dotted",
                textUnderlineOffset: 2,
                textDecorationColor: "currentColor",
                textDecorationThickness: 1,
                cursor: "help",
              } : null),
            }}
            onClick={(e) => { if (r.title) e.stopPropagation(); }}
          >
            {r.label}
          </Box>
        );
        return (
          <Box
            key={r.id}
            onClick={() => onToggle(r.id)}
            sx={{
              display: "flex", alignItems: "center", gap: 0.5,
              py: 0.25, px: 0.5,
              cursor: "pointer", borderRadius: 0.5,
              "&:hover": { bgcolor: "action.hover" },
              bgcolor: isSelected ? "action.selected" : "transparent",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, fontSize: 11 }}>
              {r.title
                ? <Tooltip title={r.title} placement="right" arrow>{textSpan}</Tooltip>
                : textSpan}
            </Box>
            <Box sx={{
              width: 50, height: 6,
              bgcolor: "action.disabledBackground",
              borderRadius: 1, flexShrink: 0,
            }}>
              <Box sx={{
                height: "100%",
                width: `${width}%`,
                bgcolor: isSelected ? "primary.main" : color,
                borderRadius: 1,
              }} />
            </Box>
            <Box sx={{
              width: 36, fontSize: 10, color: "text.secondary",
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}>
              {r.count}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
