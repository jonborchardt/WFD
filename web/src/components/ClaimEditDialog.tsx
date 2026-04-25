import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  MenuItem,
  Typography,
} from "@mui/material";

export type ClaimEditField = "text" | "kind" | "hostStance" | "rationale";

interface Props {
  open: boolean;
  field: ClaimEditField;
  initialValue: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  /** Admin writes directly; public opens a GitHub issue. Controls submit label. */
  mode: "admin" | "public";
}

const KIND_OPTIONS = ["empirical", "historical", "speculative", "opinion", "definitional"];
const STANCE_OPTIONS = ["", "asserts", "denies", "uncertain", "steelman"];

// Replaces the old native `prompt()` flow with a real MUI dialog.
// Multi-line for rationale/text, select for kind/stance. Submit is
// disabled if the text is empty.
export function ClaimEditDialog({ open, field, initialValue, onCancel, onSubmit, mode }: Props) {
  const [value, setValue] = useState(initialValue);

  // Reset on open (parent bumps a key or we key the dialog by field+initialValue).
  // Cheap: useState initializer runs once; parent should key the Dialog on the
  // target claim id to force a remount when switching claims.

  const isSelect = field === "kind" || field === "hostStance";
  const multiLine = field === "text" || field === "rationale";

  let inputEl;
  if (field === "kind") {
    inputEl = (
      <TextField select fullWidth value={value} onChange={(e) => setValue(e.target.value)} label="kind">
        {KIND_OPTIONS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
      </TextField>
    );
  } else if (field === "hostStance") {
    inputEl = (
      <TextField select fullWidth value={value} onChange={(e) => setValue(e.target.value)} label="host stance">
        {STANCE_OPTIONS.map((k) => <MenuItem key={k} value={k}>{k || "(none)"}</MenuItem>)}
      </TextField>
    );
  } else {
    inputEl = (
      <TextField
        fullWidth
        multiline={multiLine}
        minRows={multiLine ? 3 : 1}
        maxRows={multiLine ? 10 : 1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        label={field}
      />
    );
  }

  const canSubmit = isSelect ? true : value.trim().length > 0;

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>
        {mode === "admin" ? "Edit" : "Suggest"} claim {field}
      </DialogTitle>
      <DialogContent>
        {mode === "public" && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            opens a prefilled GitHub issue; an admin can one-click apply the change.
          </Typography>
        )}
        {inputEl}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>cancel</Button>
        <Button
          variant="contained"
          disabled={!canSubmit}
          onClick={() => onSubmit(value)}
        >
          {mode === "admin" ? "save" : "open issue"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
