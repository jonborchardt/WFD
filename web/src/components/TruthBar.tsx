import { Box, Typography } from "@mui/material";
import {
  TRUTH_FALSE, TRUTH_NEUTRAL, TRUTH_TRUE, truthLabel,
} from "../lib/truth-palette";
import type { TruthSource } from "../types";

// Truth bar is a 10-cell grid (5 on each side of a center divider).
// The center cell is the neutral/uncertain anchor; cells fill from
// there outward — red going left for falsey values, green going
// right for truthy values. Bar length = intensity, color = side.
const CELLS_PER_SIDE = 5;

interface Props {
  value: number | null | undefined;
  source?: TruthSource;
  label?: string;
  width?: number | string;
  /** Minimum width of the inline text label. Default 160 aligns
   * labels in a vertical list; pass a smaller number (or 0) in
   * narrow cards where each row sizes to content. */
  minLabelWidth?: number;
}

// A single horizontal bar showing a 0..1 score. Colored by the truth
// palette for truth values; rendered neutral gray for raw confidence bars
// (detected via label). Track + midline are theme-adaptive so the bar
// reads correctly in dark mode.
export function TruthBar({
  value, source, label = "truth", width = 160, minLabelWidth = 160,
}: Props) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
        {label === "confidence" ? "—" : "uncalibrated"}
      </Typography>
    );
  }
  const pct = Math.max(0, Math.min(1, value));
  const isTruth = label !== "confidence";
  const displayLabel = isTruth ? truthLabel(pct) : label;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.25 }}>
      {isTruth ? (
        <TruthCells pct={pct} />
      ) : (
        <ConfidenceBar pct={pct} width={width} />
      )}
      <Typography variant="caption" color="text.primary" sx={{
        minWidth: minLabelWidth, fontWeight: 500,
      }}>
        {displayLabel} {pct.toFixed(2)}
        {source ? ` (${source})` : ""}
      </Typography>
    </Box>
  );
}

function TruthCells({ pct }: { pct: number }) {
  // Distance from the 0.5 center, mapped to the number of cells
  // filled on that side. Ceil so any non-zero lean lights at least
  // one cell; exactly 0.5 leaves every cell empty.
  const signed = (pct - 0.5) * 2;
  const dist = Math.abs(signed);
  const filled = dist === 0 ? 0 : Math.min(
    CELLS_PER_SIDE, Math.ceil(dist * CELLS_PER_SIDE),
  );
  const leftFilled = signed < 0 ? filled : 0;
  const rightFilled = signed > 0 ? filled : 0;

  const sideCells = (
    filledCount: number, filledColor: string, side: "left" | "right",
  ) =>
    [...Array(CELLS_PER_SIDE)].map((_, i) => {
      // Fills from center outward. On the left side, the cell
      // closest to center is the rightmost (i = 4), so its distance
      // from center is 1. On the right side, the cell closest to
      // center is the leftmost (i = 0), distance 1.
      const distFromCenter =
        side === "left" ? CELLS_PER_SIDE - i : i + 1;
      const on = distFromCenter <= filledCount;
      return (
        <Cell
          key={`${side}${i}`}
          color={on ? filledColor : TRUTH_NEUTRAL}
        />
      );
    });

  return (
    <Box sx={{
      display: "flex", alignItems: "center",
      flexShrink: 0, gap: "3px",
    }}>
      {sideCells(leftFilled, TRUTH_FALSE, "left")}
      <Box sx={{
        width: "6px", height: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Box sx={{
          width: 2, height: 12,
          backgroundColor: "rgba(255,255,255,0.55)",
          borderRadius: 0.5,
        }} />
      </Box>
      {sideCells(rightFilled, TRUTH_TRUE, "right")}
    </Box>
  );
}

function Cell({ color }: { color: string }) {
  return (
    <Box sx={{
      width: 12, height: 12, borderRadius: "2px",
      backgroundColor: color,
      border: "1px solid rgba(0,0,0,0.4)",
    }} />
  );
}

function ConfidenceBar({ pct, width }: { pct: number; width: number | string }) {
  return (
    <Box sx={{
      width, height: 8, flexShrink: 0,
      borderRadius: 1, backgroundColor: TRUTH_NEUTRAL,
      position: "relative", overflow: "hidden",
    }}>
      <Box sx={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: `${pct * 100}%`,
        backgroundColor: "text.secondary",
      }} />
    </Box>
  );
}
