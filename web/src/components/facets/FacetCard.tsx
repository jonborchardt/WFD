// Shared facet-card wrapper used on the home page facet rail and on the
// claims / contradictions facet pages. Thin visual shell: left-edge
// color strip, uppercase type label, optional selected/total counts.
// Content (bar list, numeric brush, sort radio, etc.) goes in children.

import type { ReactNode } from "react";
import { Box, Chip, Typography } from "@mui/material";

interface Props {
  label: string;
  color?: string;
  total?: number;
  selected?: number;
  children: ReactNode;
  rightAdornment?: ReactNode;
}

export function FacetCard({
  label,
  color = "#90caf9",
  total,
  selected,
  children,
  rightAdornment,
}: Props) {
  return (
    <Box sx={{
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
          {label}
        </Typography>
        {selected !== undefined && selected > 0 && (
          <Chip
            size="small"
            label={selected}
            color="primary"
            sx={{
              height: 14, fontSize: 9,
              "& .MuiChip-label": { px: 0.5 },
            }}
          />
        )}
        {total !== undefined && (
          <Typography sx={{
            fontSize: 10, color: "text.secondary",
            fontVariantNumeric: "tabular-nums",
          }}>
            {total}
          </Typography>
        )}
        {rightAdornment}
      </Box>
      {children}
    </Box>
  );
}
