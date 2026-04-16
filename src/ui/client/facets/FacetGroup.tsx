// One row of facets for a single entity type.
//
// Renders N side-by-side <FacetBar>s — one per selection slot for this type.
// Each slot's top-25 is computed against the global active-video set AND-
// narrowed by all OTHER slots of the same type. That's the coref trick: the
// second slot of "person" shows the persons that co-occur in videos where
// slot #1's selections live.

import { useEffect, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { FacetBar } from "./FacetBar.js";
import {
  activeVideoIds,
  topEntitiesForType,
  totalMentionsForType,
  type FacetBundle,
  type Selection,
  type FacetRow,
} from "./duck.js";

interface Props {
  type: string;
  selection: Selection;
  bundle: FacetBundle;
  onToggle: (type: string, groupIdx: number, entityId: string) => void;
  onRemoveSlot: (type: string, groupIdx: number) => void;
  onEnsureType: (type: string) => void;
}

function selectionExcluding(selection: Selection, type: string, slotIdx: number): Selection {
  return selection.map((entry) => {
    if (entry.type !== type) return entry;
    return { type, groups: entry.groups.filter((_, i) => i !== slotIdx) };
  });
}

export function FacetGroup({ type, selection, bundle, onToggle, onRemoveSlot, onEnsureType }: Props) {
  useEffect(() => { onEnsureType(type); }, [type, onEnsureType]);

  const entry = selection.find((e) => e.type === type);
  const groups: Set<string>[] = entry?.groups || [new Set<string>()];

  const { slots, maxTotal } = useMemo(() => {
    const out: { top: FacetRow[]; pinned: FacetRow[]; selected: Set<string> }[] = [];
    for (let i = 0; i < groups.length; i++) {
      const scoped = activeVideoIds(bundle, selectionExcluding(selection, type, i));
      const otherSelected = new Set<string>();
      for (let j = 0; j < groups.length; j++) {
        if (j === i) continue;
        for (const eid of groups[j]) otherSelected.add(eid);
      }
      const { top, pinned } = topEntitiesForType(bundle, type, scoped, 15, groups[i], otherSelected);
      out.push({ top, pinned, selected: groups[i] });
    }
    const max = out.reduce(
      (m, s) => Math.max(m, s.top[0]?.total || 0, ...s.pinned.map((p) => p.total)),
      0,
    ) || 1;
    return { slots: out, maxTotal: max };
  }, [bundle, selection, groups, type]);

  const activeAll = useMemo(() => activeVideoIds(bundle, selection), [bundle, selection]);
  const totalMentions = useMemo(() => totalMentionsForType(bundle, type, activeAll), [bundle, type, activeAll]);

  const searchOptions = useMemo(() => {
    const opts: { entityId: string; canonical: string; mentions: number }[] = [];
    for (const meta of bundle.entities.values()) {
      if (meta.type !== type) continue;
      const facts = bundle.factsByEntity.get(meta.id);
      const mentions = facts ? facts.reduce((s, f) => s + f.count, 0) : 0;
      opts.push({ entityId: meta.id, canonical: meta.canonical, mentions });
    }
    opts.sort((a, b) => b.mentions - a.mentions);
    return opts;
  }, [bundle, type]);

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5, textTransform: "uppercase", color: "text.secondary" }}>
        {type} · {totalMentions.toLocaleString()} mentions
      </Typography>
      {groups.length > 1 && (
        <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary", fontStyle: "italic" }}>
          Co-occurrence mode: each slot shows {type}s that appear in videos alongside the selections in the other slot{groups.length > 2 ? "s" : ""}.
        </Typography>
      )}
      <Box sx={{ display: "flex", gap: 1, overflowX: "auto", pb: 1 }}>
        {slots.map((s, i) => (
          <FacetBar
            key={i}
            title={type + " #" + (i + 1)}
            type={type}
            top={s.top}
            pinned={s.pinned}
            selected={s.selected}
            maxTotal={maxTotal}
            onToggle={(eid: string) => onToggle(type, i, eid)}
            onRemove={() => onRemoveSlot(type, i)}
            removable={i > 0}
            searchOptions={searchOptions}
          />
        ))}
      </Box>
    </Box>
  );
}
