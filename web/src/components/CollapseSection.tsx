import type { ReactNode } from "react";
import { Box, Collapse, Typography } from "@mui/material";

// Shared collapse-trigger style — kept in one place so the entity
// graph and the argument map sidebars stay in lockstep.
export const sectionHeaderSx = {
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  cursor: "pointer",
  userSelect: "none" as const,
  color: "text.secondary",
  "&:hover": { color: "text.primary" },
};

interface Props {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  sx?: object;
  children: ReactNode;
}

export function CollapseSection({ title, count, open, onToggle, sx, children }: Props) {
  return (
    <Box sx={{ mt: 1.5, ...sx }}>
      <Box onClick={onToggle} sx={sectionHeaderSx}>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          {open ? "▾" : "▸"} {title}
          {count !== undefined ? ` (${count})` : ""}
        </Typography>
      </Box>
      <Collapse in={open}>{children}</Collapse>
    </Box>
  );
}
