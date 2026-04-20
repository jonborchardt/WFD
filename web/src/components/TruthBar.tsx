import { Box, Tooltip, Typography } from "@mui/material";
import { truthColor, truthLabel } from "../lib/truth-palette";
import type { TruthSource } from "../types";

interface Props {
  value: number | null | undefined;
  source?: TruthSource;
  label?: string;
  width?: number | string;
}

// A single horizontal bar showing a 0..1 score. Colored by the truth
// palette for truth values; rendered neutral gray for raw confidence bars
// when `source === undefined` and `label === "confidence"`.
export function TruthBar({ value, source, label = "truth", width = 160 }: Props) {
  if (value === null || value === undefined) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
        {label === "confidence" ? "—" : "uncalibrated"}
      </Typography>
    );
  }
  const pct = Math.max(0, Math.min(1, value));
  const isTruth = label !== "confidence";
  const fill = isTruth ? truthColor(pct) : "#757575";
  const tip = isTruth
    ? `${label} ${pct.toFixed(2)} · ${truthLabel(pct)}${source ? ` (${source})` : ""}`
    : `${label} ${pct.toFixed(2)}`;
  return (
    <Tooltip title={tip} arrow>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.25 }}>
        <Box
          sx={{
            width,
            height: 8,
            borderRadius: 1,
            background: "#e0e0e0",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct * 100}%`,
              background: fill,
            }}
          />
          {isTruth && (
            <Box
              sx={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: 1,
                background: "rgba(255,255,255,0.7)",
              }}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 130 }}>
          {label} {pct.toFixed(2)}
          {source ? ` (${source})` : ""}
        </Typography>
      </Box>
    </Tooltip>
  );
}
