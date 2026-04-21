import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
  TextField,
  Button,
  Box,
  Typography,
} from "@mui/material";
import { truthColor, truthLabel } from "../lib/truth-palette";

interface Props {
  open: boolean;
  initialTruth: number;
  onCancel: () => void;
  onSubmit: (truth: number, rationale: string) => void;
  mode: "admin" | "public";
}

// Slider-based truth override with a live color preview + truth label.
// Rationale is a separate multi-line box. Public mode just swaps the
// submit caption.
export function TruthOverrideDialog({ open, initialTruth, onCancel, onSubmit, mode }: Props) {
  const [truth, setTruth] = useState(initialTruth);
  const [rationale, setRationale] = useState("");

  useEffect(() => {
    if (open) {
      setTruth(initialTruth);
      setRationale("");
    }
  }, [open, initialTruth]);

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>
        {mode === "admin" ? "Override claim truth" : "Suggest claim truth"}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <Box sx={{ width: 40, height: 16, background: truthColor(truth), borderRadius: 1 }} />
          <Typography variant="body2">
            {truth.toFixed(2)} · {truthLabel(truth)}
          </Typography>
        </Box>
        <Slider
          value={truth}
          onChange={(_, v) => setTruth(Array.isArray(v) ? v[0] : v)}
          min={0}
          max={1}
          step={0.01}
          marks={[
            { value: 0, label: "false" },
            { value: 0.5, label: "?" },
            { value: 1, label: "true" },
          ]}
        />
        <TextField
          fullWidth
          multiline
          minRows={3}
          label="rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>cancel</Button>
        <Button variant="contained" onClick={() => onSubmit(truth, rationale)}>
          {mode === "admin" ? "save" : "open issue"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
