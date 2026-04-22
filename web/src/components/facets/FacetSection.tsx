// One grid per semantic group (sort, claim type, magnitudes, …) with
// a small overline header. Used by the faceted claims / contradictions
// pages so the rail reads as ordered sections instead of a single
// undifferentiated grid of cards.

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

interface Props {
  title: string;
  children: ReactNode;
}

export function FacetSection({ title, children }: Props) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline" sx={{
        display: "block",
        lineHeight: 1.4, fontSize: 10, color: "text.secondary",
        mb: 0.5,
      }}>
        {title}
      </Typography>
      <Box sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 1,
      }}>
        {children}
      </Box>
    </Box>
  );
}
