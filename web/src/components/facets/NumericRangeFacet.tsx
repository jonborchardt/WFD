// Brush over an arbitrary numeric domain. Takes pre-computed histogram
// bins and a current selection; returns a [min, max] range (or null
// for "no filter") via onChange.
//
// Used for claim truth / confidence / shared-entity count / similarity
// — anywhere we want the home page's brush feel over a non-time axis.
// Click without drag clears the selection, matching BrushFacet.

import { useRef, useState } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";

export interface RangeBin {
  min: number;
  max: number;
  count: number;
}

interface Props {
  bins: RangeBin[];
  domain: [number, number];
  selected: [number, number] | null;
  onChange: (range: [number, number] | null) => void;
  format?: (v: number) => string;
  color?: string;
}

const HEIGHT = 40;

export function NumericRangeFacet({
  bins,
  domain,
  selected,
  onChange,
  format = (v) => v.toFixed(2),
  color = "#90caf9",
}: Props) {
  const [dMin, dMax] = domain;
  const span = (dMax - dMin) || 1;
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  const chartRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [width, setWidth] = useState(0);

  const xOf = (v: number) => {
    if (width === 0) return 0;
    return ((v - dMin) / span) * width;
  };
  const vOf = (x: number) => {
    const clamped = Math.max(0, Math.min(width, x));
    return dMin + (clamped / (width || 1)) * span;
  };

  const selX0 = selected ? xOf(selected[0]) : 0;
  const selX1 = selected ? xOf(selected[1]) : 0;

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
    if (b - a < 3) {
      onChange(null);
      return;
    }
    onChange([vOf(a), vOf(b)]);
  };

  const dragX0 = drag ? Math.min(drag.x0, drag.x1) : 0;
  const dragX1 = drag ? Math.max(drag.x0, drag.x1) : 0;

  return (
    <Box>
      <Box sx={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        gap: 1, fontSize: 10, color: "text.secondary",
        fontVariantNumeric: "tabular-nums", lineHeight: 1.2, mb: 0.25,
      }}>
        <span>{format(dMin)}</span>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <span>
            {selected
              ? `${format(selected[0])}–${format(selected[1])}`
              : "drag to select range"}
          </span>
          {selected && (
            <Tooltip title="clear">
              <IconButton
                size="small"
                onClick={() => onChange(null)}
                sx={{ p: 0, width: 16, height: 16 }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <span>{format(dMax)}</span>
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
          bgcolor: "action.disabledBackground",
          borderRadius: 0.5, cursor: "crosshair",
          userSelect: "none", touchAction: "none", overflow: "hidden",
        }}
      >
        {bins.map((b, i) => {
          const x0 = xOf(b.min);
          const x1 = xOf(b.max);
          const w = Math.max(1, x1 - x0 - 1);
          const h = b.count === 0
            ? 0
            : Math.max(2, (b.count / maxCount) * (HEIGHT - 4));
          const midX = (x0 + x1) / 2;
          const inBrush = drag
            ? midX >= dragX0 && midX <= dragX1
            : selected
              ? b.max >= selected[0] && b.min <= selected[1]
              : false;
          if (h === 0) return null;
          return (
            <Tooltip
              key={i}
              title={`${format(b.min)}–${format(b.max)}: ${b.count}`}
              arrow
              disableInteractive
            >
              <Box
                sx={{
                  position: "absolute", left: x0, bottom: 0,
                  width: w, height: h,
                  bgcolor: inBrush ? "primary.main" : color,
                  opacity: inBrush ? 1 : 0.85,
                }}
              />
            </Tooltip>
          );
        })}
        {drag && dragX1 - dragX0 >= 1 && (
          <Box sx={{
            position: "absolute", left: dragX0, top: 0,
            width: dragX1 - dragX0, height: HEIGHT,
            bgcolor: "rgba(33,150,243,0.2)",
            border: "1px solid rgba(33,150,243,0.8)",
            pointerEvents: "none",
          }} />
        )}
        {!drag && selected && selX1 - selX0 >= 1 && (
          <Box sx={{
            position: "absolute", left: selX0, top: 0,
            width: Math.max(2, selX1 - selX0), height: HEIGHT,
            bgcolor: "rgba(33,150,243,0.15)",
            border: "1px dashed rgba(33,150,243,0.6)",
            pointerEvents: "none",
          }} />
        )}
      </Box>
    </Box>
  );
}
