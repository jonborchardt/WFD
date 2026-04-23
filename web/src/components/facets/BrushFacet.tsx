// Brushable time-axis histogram, used for the decade / year /
// specific_month / specific_week entity types. Each bar represents one
// entity (e.g. year=2015) positioned along the x-axis by its parsed
// time value; bar height is mention count. Drag horizontally to select
// a contiguous range; the current selection (for this facet type) is
// replaced with every entity id whose time falls inside the brush.

import { useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { FacetBundle, Selection } from "./duck";
import { activeVideoIds, topEntitiesForType } from "./duck";

export const TIME_FACET_TYPES: ReadonlySet<string> = new Set([
  "decade",
  "year",
  "specific_month",
  "specific_week",
]);

interface Props {
  type: string;
  selection: Selection;
  bundle: FacetBundle;
  selected: Set<string>;
  onSetGroup: (ids: Set<string>) => void;
}

// Parse the canonical form into a UTC timestamp (ms). Returns null if
// the canonical does not look like this type's expected shape.
export function timeValue(type: string, canonical: string): number | null {
  if (type === "year") {
    if (!/^\d{4}$/.test(canonical)) return null;
    return Date.UTC(parseInt(canonical, 10), 0, 1);
  }
  if (type === "decade") {
    const m = canonical.match(/^(\d{4})s$/);
    if (!m) return null;
    return Date.UTC(parseInt(m[1], 10), 0, 1);
  }
  if (type === "specific_month") {
    const m = canonical.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, 1);
  }
  if (type === "specific_week") {
    const m = canonical.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  return null;
}

export function axisLabel(type: string, t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  if (type === "year") return `${y}`;
  if (type === "decade") return `${y}s`;
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (type === "specific_month") return `${y}-${m}`;
  return `${y}-${m}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const HEIGHT = 44;

export function BrushFacet({ type, selection, bundle, selected, onSetGroup }: Props) {
  // Scope the counts to every other facet selection except this type,
  // so the bars reflect what's currently reachable through the rest of
  // the filter. Mirrors the existing FacetBar scoping behaviour.
  const scoped = useMemo(
    () => activeVideoIds(bundle, selection.filter((e) => e.type !== type)),
    [bundle, selection, type],
  );
  const { top } = useMemo(
    () => topEntitiesForType(bundle, type, scoped, 1_000_000),
    [bundle, type, scoped],
  );

  const rows = useMemo(() => {
    const out: { entityId: string; canonical: string; total: number; t: number }[] = [];
    for (const r of top) {
      const t = timeValue(type, r.canonical);
      if (t === null) continue;
      out.push({ entityId: r.entityId, canonical: r.canonical, total: r.total, t });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [top, type]);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [width, setWidth] = useState(0);

  const minT = rows[0]?.t ?? 0;
  const maxT = rows[rows.length - 1]?.t ?? 0;
  const maxCount = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;

  const xOf = (t: number) => {
    if (width === 0 || maxT === minT) return 0;
    return ((t - minT) / (maxT - minT)) * width;
  };
  const tOf = (px: number) => {
    const clamped = Math.max(0, Math.min(width, px));
    if (maxT === minT) return minT;
    return minT + (clamped / width) * (maxT - minT);
  };

  // Bounding rect of the selected entities (if any), so the user can
  // see their previous selection highlighted between sessions.
  let selX0 = 0;
  let selX1 = 0;
  let hasSel = false;
  if (selected.size > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      if (!selected.has(r.entityId)) continue;
      if (r.t < lo) lo = r.t;
      if (r.t > hi) hi = r.t;
      hasSel = true;
    }
    if (hasSel) {
      selX0 = xOf(lo);
      selX1 = xOf(hi);
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    if (width !== rect.width) setWidth(rect.width);
    const x = e.clientX - rect.left;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x0: x, x1: x });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setDrag({ ...drag, x1: x });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const a = Math.min(drag.x0, drag.x1);
    const b = Math.max(drag.x0, drag.x1);
    setDrag(null);
    // Treat a single click (no drag distance) as a clear.
    if (b - a < 2) {
      onSetGroup(new Set());
      return;
    }
    const t0 = tOf(a);
    const t1 = tOf(b);
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.t >= t0 && r.t <= t1) ids.add(r.entityId);
    }
    onSetGroup(ids);
  };

  const dragX0 = drag ? Math.min(drag.x0, drag.x1) : 0;
  const dragX1 = drag ? Math.max(drag.x0, drag.x1) : 0;

  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
        no {type} data in the current filter
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", maxWidth: 960 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          fontSize: 10,
          color: "text.secondary",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
          mb: 0.25,
        }}
      >
        <span>{axisLabel(type, minT)}</span>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <span>
            {hasSel ? `${selected.size} selected` : "drag to select range"}
          </span>
          {hasSel && (
            <Tooltip title="clear brush">
              <IconButton size="small" onClick={() => onSetGroup(new Set())} sx={{ p: 0, width: 16, height: 16 }}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <span>{axisLabel(type, maxT)}</span>
      </Box>
      <Box
        ref={(el: HTMLDivElement | null) => {
          chartRef.current = el;
          if (el && width !== el.clientWidth) setWidth(el.clientWidth);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        sx={{
          position: "relative",
          width: "100%",
          height: HEIGHT,
          bgcolor: "action.disabledBackground",
          borderRadius: 0.5,
          cursor: "crosshair",
          userSelect: "none",
          touchAction: "none",
          overflow: "hidden",
        }}
      >
        {rows.map((r) => {
          const x = xOf(r.t);
          // count 0 → no bar (height 0). count ≥ 1 → at least MIN_H so
          // it's visible. Scale by effectiveMax (floored at 5) so a
          // single mention never fills the chart when the rest of the
          // corpus happens to have nothing in range.
          const USABLE = HEIGHT - 4;
          const MIN_H = 2;
          const effectiveMax = Math.max(maxCount, 5);
          const h =
            r.total <= 0
              ? 0
              : Math.max(MIN_H, (r.total / effectiveMax) * USABLE);
          const inBrush = drag
            ? x >= dragX0 && x <= dragX1
            : hasSel && x >= selX0 && x <= selX1;
          if (h === 0) return null;
          return (
            <Tooltip
              key={r.entityId}
              title={`${r.canonical} · ${r.total.toLocaleString()}`}
              arrow
              disableInteractive
            >
              <Box
                sx={{
                  position: "absolute",
                  left: x - 1,
                  bottom: 0,
                  width: 2,
                  height: h,
                  bgcolor: (t) => inBrush ? t.palette.primary.main : t.palette.facet.accent,
                  opacity: inBrush ? 1 : 0.85,
                }}
              />
            </Tooltip>
          );
        })}
        {drag && dragX1 - dragX0 >= 1 && (
          <Box
            sx={{
              position: "absolute",
              left: dragX0,
              top: 0,
              width: dragX1 - dragX0,
              height: HEIGHT,
              bgcolor: (t) => alpha(t.palette.facet.brushHue, 0.2),
              border: (t) => `1px solid ${alpha(t.palette.facet.brushHue, 0.8)}`,
              pointerEvents: "none",
            }}
          />
        )}
        {!drag && hasSel && selX1 - selX0 >= 1 && (
          <Box
            sx={{
              position: "absolute",
              left: selX0,
              top: 0,
              width: Math.max(2, selX1 - selX0),
              height: HEIGHT,
              bgcolor: (t) => alpha(t.palette.facet.brushHue, 0.15),
              border: (t) => `1px dashed ${alpha(t.palette.facet.brushHue, 0.6)}`,
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
    </Box>
  );
}
