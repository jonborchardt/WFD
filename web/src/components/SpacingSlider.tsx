import { Box, Slider, Typography } from "@mui/material";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

// "Tight ←→ loose" spacing slider used in the entity map and the
// argument map sidebars. The outer padding gives the edge mark labels
// (which sit ±half-label-width past the track) room to stay inside
// the panel.
export function SpacingSlider({ value, min, max, step = 10, onChange }: Props) {
  return (
    <Box sx={{ mt: 1.5, px: 2.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: -2 }}>
        spacing
      </Typography>
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        marks={[{ value: min, label: "tight" }, { value: max, label: "loose" }]}
        onChange={(_, v) => onChange(v as number)}
        valueLabelDisplay="auto"
      />
    </Box>
  );
}
