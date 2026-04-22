import { useState } from "react";
import {
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography,
} from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { IS_ADMIN } from "../lib/admin";
import {
  contradictionDismissIssueUrl,
  customContradictionIssueUrl,
} from "../lib/issues";

interface Props {
  leftId: string;
  rightId: string;
  isCustom?: boolean;
  onMutated?: () => void;
}

// Admin: direct POST to /api/aliases/. Public: opens a prefilled GitHub
// issue. Two dialogs — one for dismiss-reason (optional textarea) and
// one for adding a custom conflict (required summary).
export function ContradictionMenu({ leftId, rightId, isCustom, onMutated }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");
  const [customSummary, setCustomSummary] = useState("");
  const close = () => setAnchor(null);

  async function post(action: string, extra: Record<string, string>) {
    const body = new URLSearchParams({ a: leftId, b: rightId, ...extra });
    const r = await fetch(`/api/aliases/${action}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      alert(`failed: ${err.error || r.statusText}`);
      return;
    }
    close();
    onMutated?.();
  }

  function go(url: string) {
    window.open(url, "_blank", "noopener");
    close();
  }

  async function submitDismiss() {
    const reason = dismissReason;
    setDismissReason("");
    setDismissOpen(false);
    if (IS_ADMIN) await post("dismiss-contradiction", { reason });
    else go(contradictionDismissIssueUrl(leftId, rightId, reason));
  }

  async function submitCustom() {
    if (!customSummary.trim()) return;
    const summary = customSummary;
    setCustomSummary("");
    setCustomOpen(false);
    if (IS_ADMIN) await post("custom-contradiction", { summary });
    else go(customContradictionIssueUrl(leftId, rightId, summary));
  }

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="edit contradiction">
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem onClick={() => { setDismissOpen(true); close(); }}>
          {IS_ADMIN ? "dismiss contradiction…" : "suggest dismissing…"}
        </MenuItem>
        {IS_ADMIN && (
          <MenuItem onClick={() => post("undismiss-contradiction", {})}>
            un-dismiss
          </MenuItem>
        )}
        <MenuItem onClick={() => { setCustomOpen(true); close(); }}>
          {IS_ADMIN ? "add custom contradiction…" : "flag related conflict…"}
        </MenuItem>
        {IS_ADMIN && isCustom && (
          <MenuItem onClick={() => post("uncustom-contradiction", {})}>
            delete custom contradiction
          </MenuItem>
        )}
      </Menu>

      <Dialog open={dismissOpen} onClose={() => setDismissOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{IS_ADMIN ? "Dismiss contradiction" : "Suggest dismissal"}</DialogTitle>
        <DialogContent>
          {!IS_ADMIN && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              opens a prefilled GitHub issue with a one-click admin apply link.
            </Typography>
          )}
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="reason (optional)"
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDismissOpen(false)}>cancel</Button>
          <Button variant="contained" onClick={submitDismiss}>
            {IS_ADMIN ? "dismiss" : "open issue"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{IS_ADMIN ? "Add custom contradiction" : "Flag new conflict"}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={2}
            required
            label="summary of the conflict"
            value={customSummary}
            onChange={(e) => setCustomSummary(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomOpen(false)}>cancel</Button>
          <Button variant="contained" disabled={!customSummary.trim()} onClick={submitCustom}>
            {IS_ADMIN ? "add" : "open issue"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
