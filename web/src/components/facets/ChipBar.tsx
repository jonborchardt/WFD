import { Fragment } from "react";
import { Box, Chip, Button, Typography } from "@mui/material";
import { ENTITY_TYPE_COLOR } from "../catalog-columns";
import type { FacetBundle, Selection } from "./duck";

interface Props {
  selection: Selection;
  bundle: FacetBundle;
  onToggle: (type: string, groupIdx: number, entityId: string) => void;
  onClearAll: () => void;
}

interface SlotChips {
  type: string;
  gi: number;
  items: { eid: string; canonical: string }[];
}

function OpBadge({ op }: { op: "AND" | "OR" }) {
  return (
    <Box
      sx={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        color: op === "AND" ? "primary.main" : "text.secondary",
        border: 1,
        borderColor: op === "AND" ? "primary.main" : "divider",
        borderRadius: 0.5,
        px: 0.5,
        py: 0.125,
        bgcolor: "action.hover",
        lineHeight: 1.4,
      }}
    >
      {op}
    </Box>
  );
}

export function ChipBar({ selection, bundle, onToggle, onClearAll }: Props) {
  const slots: SlotChips[] = [];
  for (const { type, groups } of selection) {
    groups.forEach((g, gi) => {
      const items: { eid: string; canonical: string }[] = [];
      for (const eid of g) {
        const meta = bundle.entities.get(eid);
        if (!meta) continue;
        items.push({ eid, canonical: meta.canonical });
      }
      if (items.length > 0) slots.push({ type, gi, items });
    });
  }
  if (slots.length === 0) {
    return (
      <Box sx={{ py: 0.25, color: "text.secondary" }}>
        <Typography variant="caption">no filters — showing all videos</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ py: 0.25, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: 10 }}>filters:</Typography>
      {slots.map((slot, slotIdx) => (
        <Fragment key={slot.type + ":" + slot.gi}>
          {slotIdx > 0 && <OpBadge op="AND" />}
          {slot.items.length > 1 && (
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                px: 0.5,
                py: 0.25,
                border: 1,
                borderStyle: "dashed",
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              {slot.items.map((c, i) => (
                <Fragment key={c.eid}>
                  {i > 0 && <OpBadge op="OR" />}
                  <Chip
                    size="small"
                    label={c.canonical + " (#" + (slot.gi + 1) + ")"}
                    color={ENTITY_TYPE_COLOR[slot.type] || "default"}
                    onDelete={() => onToggle(slot.type, slot.gi, c.eid)}
                  />
                </Fragment>
              ))}
            </Box>
          )}
          {slot.items.length === 1 && (
            <Chip
              size="small"
              label={slot.items[0].canonical + " (#" + (slot.gi + 1) + ")"}
              color={ENTITY_TYPE_COLOR[slot.type] || "default"}
              onDelete={() => onToggle(slot.type, slot.gi, slot.items[0].eid)}
            />
          )}
        </Fragment>
      ))}
      <Button size="small" onClick={onClearAll} sx={{ ml: 1 }}>clear all</Button>
    </Box>
  );
}
