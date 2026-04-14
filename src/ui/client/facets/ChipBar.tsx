// Active-filter chip row. Shows every currently-selected entity across all
// types and slots. Clicking × on a chip removes just that entity from its
// slot (via onToggle, which is a pure flip).

import { Box, Chip, Button, Typography } from "@mui/material";
import { ENTITY_TYPE_COLOR } from "../shared/catalog-columns.js";
import type { FacetBundle, Selection } from "./duck.js";

interface Props {
  selection: Selection;
  bundle: FacetBundle;
  onToggle: (type: string, groupIdx: number, entityId: string) => void;
  onClearAll: () => void;
}

export function ChipBar({ selection, bundle, onToggle, onClearAll }: Props) {
  const chips: { type: string; gi: number; eid: string; canonical: string }[] = [];
  for (const { type, groups } of selection) {
    groups.forEach((g, gi) => {
      for (const eid of g) {
        const meta = bundle.entities.get(eid);
        if (!meta) continue;
        chips.push({ type, gi, eid, canonical: meta.canonical });
      }
    });
  }
  if (chips.length === 0) {
    return (
      <Box sx={{ py: 1, color: "text.secondary" }}>
        <Typography variant="body2">No filters — showing all videos. Click a bar to start.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ py: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>filters:</Typography>
      {chips.map((c) => (
        <Chip
          key={c.type + ":" + c.gi + ":" + c.eid}
          size="small"
          label={c.canonical + " (#" + (c.gi + 1) + ")"}
          color={ENTITY_TYPE_COLOR[c.type] || "default"}
          onDelete={() => onToggle(c.type, c.gi, c.eid)}
        />
      ))}
      <Button size="small" onClick={onClearAll} sx={{ ml: 1 }}>clear all</Button>
    </Box>
  );
}
