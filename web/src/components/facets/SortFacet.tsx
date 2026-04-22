// Radio-list sort picker styled to sit inside a FacetCard, so sort
// reads visually like another facet on the rail. See the proposal
// block at the top of ClaimsFacetsPage.tsx for the tradeoff with
// alternative placements (dropdown in the results header etc).

import { Box } from "@mui/material";

export interface SortOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  options: SortOption[];
  value: string;
  onChange: (v: string) => void;
}

export function SortFacet({ options, value, onChange }: Props) {
  return (
    <Box>
      {options.map((o) => {
        const isActive = o.value === value;
        return (
          <Box
            key={o.value}
            onClick={() => onChange(o.value)}
            sx={{
              display: "flex", alignItems: "center", gap: 0.5,
              py: 0.25, px: 0.5, cursor: "pointer", borderRadius: 0.5,
              "&:hover": { bgcolor: "action.hover" },
              bgcolor: isActive ? "action.selected" : "transparent",
            }}
          >
            <Box sx={{
              width: 12, height: 12, borderRadius: "50%",
              border: 1,
              borderColor: isActive ? "primary.main" : "divider",
              flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {isActive && (
                <Box sx={{
                  width: 6, height: 6, borderRadius: "50%",
                  bgcolor: "primary.main",
                }} />
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{
                fontSize: 11, lineHeight: 1.2,
                fontWeight: isActive ? 600 : 400,
              }}>
                {o.label}
              </Box>
              {o.hint && (
                <Box sx={{
                  fontSize: 9, color: "text.secondary", lineHeight: 1.1,
                }}>
                  {o.hint}
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
