// Brushable year-axis histogram for a list of pre-parsed timestamps.
// Used by the faceted claims / contradictions pages where the "row"
// isn't an entity (so BrushFacet doesn't apply) — we just have dated
// items and want the same drag-to-select feel.
//
// bucketed by year for readability; the selection is a [msLo, msHi]
// range and the consumer decides how to test membership.

import { useMemo, useRef, useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";

interface Props {
  timestamps: number[];                 // ms since epoch
  selected: [number, number] | null;    // ms range
  onChange: (r: [number, number] | null) => void;
}

const HEIGHT = 44;

export function DateBrushFacet({ timestamps, selected, onChange }: Props) {
  // Bucket by calendar month. Month-level density reads well across
  // the corpus's ~8-year span; day-level would be 250× more bars
  // without adding useful signal. The selection returned by the brush
  // is still day-granular — it just snaps its labels to a real day
  // the user dragged over.
  const bins = useMemo(() => {
    if (timestamps.length === 0) return [] as { t: number; count: number }[];
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const t of timestamps) {
      if (t < minMs) minMs = t;
      if (t > maxMs) maxMs = t;
    }
    const minD = new Date(minMs);
    const maxD = new Date(maxMs);
    const startY = minD.getUTCFullYear();
    const startM = minD.getUTCMonth();
    const endY = maxD.getUTCFullYear();
    const endM = maxD.getUTCMonth();
    const out: { t: number; count: number }[] = [];
    for (let y = startY; y <= endY; y++) {
      const fromM = y === startY ? startM : 0;
      const toM = y === endY ? endM : 11;
      for (let m = fromM; m <= toM; m++) {
        out.push({ t: Date.UTC(y, m, 1), count: 0 });
      }
    }
    for (const t of timestamps) {
      const d = new Date(t);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      // linear index since startY*12+startM
      const idx = (y - startY) * 12 + (m - startM);
      if (idx >= 0 && idx < out.length) out[idx].count += 1;
    }
    return out;
  }, [timestamps]);

  const minT = bins[0]?.t ?? 0;
  const maxT = bins[bins.length - 1]?.t ?? 0;
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  const chartRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [width, setWidth] = useState(0);

  const xOf = (t: number) => {
    if (width === 0 || maxT === minT) return 0;
    return ((t - minT) / (maxT - minT)) * width;
  };
  const tOf = (px: number) => {
    const clamped = Math.max(0, Math.min(width, px));
    if (maxT === minT) return minT;
    return minT + (clamped / width) * (maxT - minT);
  };

  let selX0 = 0;
  let selX1 = 0;
  if (selected) {
    selX0 = xOf(Math.max(minT, selected[0]));
    selX1 = xOf(Math.min(maxT, selected[1]));
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
    setDrag({ ...drag, x1: e.clientX - rect.left });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const a = Math.min(drag.x0, drag.x1);
    const b = Math.max(drag.x0, drag.x1);
    setDrag(null);
    if (b - a < 2) { onChange(null); return; }
    onChange([tOf(a), tOf(b)]);
  };

  const dragX0 = drag ? Math.min(drag.x0, drag.x1) : 0;
  const dragX1 = drag ? Math.max(drag.x0, drag.x1) : 0;

  if (bins.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ px: 1, fontSize: 10 }}>
        no date data in the current filter
      </Typography>
    );
  }

  // day-month-year labels (15 Mar 2024). Both axis endpoints and the
  // active-selection readout use the same formatter.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDmy = (t: number) => {
    const d = new Date(t);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 1, fontSize: 10, color: "text.secondary",
        fontVariantNumeric: "tabular-nums", lineHeight: 1.2, mb: 0.25,
      }}>
        <span>{fmtDmy(minT)}</span>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <span>
            {selected
              ? `${fmtDmy(selected[0])} – ${fmtDmy(selected[1])}`
              : "drag to select range"}
          </span>
          {selected && (
            <Tooltip title="clear brush">
              <IconButton size="small" onClick={() => onChange(null)} sx={{ p: 0, width: 16, height: 16 }}>
                <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <span>{fmtDmy(maxT)}</span>
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
          position: "relative", width: "100%", height: HEIGHT,
          bgcolor: "action.disabledBackground", borderRadius: 0.5,
          cursor: "crosshair", userSelect: "none", touchAction: "none",
          overflow: "hidden",
        }}
      >
        {bins.map((b) => {
          const x = xOf(b.t);
          const USABLE = HEIGHT - 4;
          const MIN_H = 2;
          const effectiveMax = Math.max(maxCount, 5);
          const h = b.count <= 0
            ? 0
            : Math.max(MIN_H, (b.count / effectiveMax) * USABLE);
          const inBrush = drag
            ? x >= dragX0 && x <= dragX1
            : selected ? b.t >= selected[0] && b.t <= selected[1] : false;
          if (h === 0) return null;
          const binD = new Date(b.t);
          const binLabel = `${MONTHS[binD.getUTCMonth()]} ${binD.getUTCFullYear()}`;
          return (
            <Box
              key={b.t}
              title={`${binLabel} · ${b.count}`}
              sx={{
                position: "absolute", left: x - 1, bottom: 0,
                width: 2, height: h,
                bgcolor: (t) => inBrush ? t.palette.primary.main : t.palette.facet.accent,
                opacity: inBrush ? 1 : 0.85,
              }}
            />
          );
        })}
        {drag && dragX1 - dragX0 >= 1 && (
          <Box sx={{
            position: "absolute", left: dragX0, top: 0,
            width: dragX1 - dragX0, height: HEIGHT,
            bgcolor: (t) => alpha(t.palette.facet.brushHue, 0.2),
            border: (t) => `1px solid ${alpha(t.palette.facet.brushHue, 0.8)}`,
            pointerEvents: "none",
          }} />
        )}
        {!drag && selected && selX1 - selX0 >= 1 && (
          <Box sx={{
            position: "absolute", left: selX0, top: 0,
            width: Math.max(2, selX1 - selX0), height: HEIGHT,
            bgcolor: (t) => alpha(t.palette.facet.brushHue, 0.15),
            border: (t) => `1px dashed ${alpha(t.palette.facet.brushHue, 0.6)}`,
            pointerEvents: "none",
          }} />
        )}
      </Box>
    </Box>
  );
}
