import { useEffect, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { FacetBar } from "./FacetBar";
import { BrushFacet, TIME_FACET_TYPES } from "./BrushFacet";
import { SimpleFacet, SIMPLE_FACET_TYPES } from "./SimpleFacet";
import {
  activeVideoIds,
  topEntitiesForType,
  totalMentionsForType,
  type FacetBundle,
  type Selection,
  type FacetRow,
} from "./duck";

interface Props {
  type: string;
  selection: Selection;
  bundle: FacetBundle;
  onToggle: (type: string, groupIdx: number, entityId: string) => void;
  onSetGroup: (type: string, groupIdx: number, ids: Set<string>) => void;
  onRemoveSlot: (type: string, groupIdx: number) => void;
  onEnsureType: (type: string) => void;
}

function selectionExcluding(selection: Selection, type: string, slotIdx: number): Selection {
  return selection.map((entry) => {
    if (entry.type !== type) return entry;
    return { type, groups: entry.groups.filter((_, i) => i !== slotIdx) };
  });
}

// Time-axis brush variant. Used for decade / year / specific_month /
// specific_week — dates, not categories, so a column of checkboxes
// would be the wrong control.
function TimeFacetGroup({ type, selection, bundle, onSetGroup, onEnsureType }: Props) {
  useEffect(() => { onEnsureType(type); }, [type, onEnsureType]);

  const entry = selection.find((e) => e.type === type);
  const selected: Set<string> = entry?.groups[0] || new Set<string>();

  const activeAll = useMemo(() => activeVideoIds(bundle, selection), [bundle, selection]);
  const totalMentions = useMemo(
    () => totalMentionsForType(bundle, type, activeAll),
    [bundle, type, activeAll],
  );

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" sx={{ display: "block", mb: 0.25, textTransform: "uppercase", color: "text.secondary", fontSize: 10, lineHeight: 1.2 }}>
        {type} · {totalMentions.toLocaleString()} mentions
      </Typography>
      <BrushFacet
        type={type}
        selection={selection}
        bundle={bundle}
        selected={selected}
        onSetGroup={(ids) => onSetGroup(type, 0, ids)}
      />
    </Box>
  );
}

// Column-of-bars variant with co-occurrence slots, search, and
// per-entity click-to-toggle. The original behaviour.
function ColumnFacetGroup({ type, selection, bundle, onToggle, onRemoveSlot, onEnsureType }: Props) {
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
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" sx={{ display: "block", mb: 0.25, textTransform: "uppercase", color: "text.secondary", fontSize: 10, lineHeight: 1.2 }}>
        {type} · {totalMentions.toLocaleString()} mentions
      </Typography>
      {groups.length > 1 && (
        <Typography variant="caption" sx={{ display: "block", mb: 0.25, color: "text.secondary", fontStyle: "italic", fontSize: 10 }}>
          Co-occurrence: each slot shows {type}s that co-occur with the other slot{groups.length > 2 ? "s" : ""}.
        </Typography>
      )}
      <Box sx={{ display: "flex", gap: 0.5, overflowX: "auto", pb: 0.5 }}>
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

// Simple toggle-bar variant. No search, no co-occurrence slots — just
// click a bar to include/exclude that category. Used for small
// closed-set types like time_of_day (morning/day/evening/night).
function SimpleFacetGroup({ type, selection, bundle, onSetGroup, onEnsureType }: Props) {
  useEffect(() => { onEnsureType(type); }, [type, onEnsureType]);

  const entry = selection.find((e) => e.type === type);
  const selected: Set<string> = entry?.groups[0] || new Set<string>();

  const activeAll = useMemo(() => activeVideoIds(bundle, selection), [bundle, selection]);
  const totalMentions = useMemo(
    () => totalMentionsForType(bundle, type, activeAll),
    [bundle, type, activeAll],
  );

  const toggleOne = (eid: string) => {
    const next = new Set(selected);
    if (next.has(eid)) next.delete(eid);
    else next.add(eid);
    onSetGroup(type, 0, next);
  };

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" sx={{ display: "block", mb: 0.25, textTransform: "uppercase", color: "text.secondary", fontSize: 10, lineHeight: 1.2 }}>
        {type} · {totalMentions.toLocaleString()} mentions
      </Typography>
      <SimpleFacet
        type={type}
        selection={selection}
        bundle={bundle}
        selected={selected}
        onToggle={toggleOne}
      />
    </Box>
  );
}

export function FacetGroup(props: Props) {
  if (TIME_FACET_TYPES.has(props.type)) return <TimeFacetGroup {...props} />;
  if (SIMPLE_FACET_TYPES.has(props.type)) return <SimpleFacetGroup {...props} />;
  return <ColumnFacetGroup {...props} />;
}
