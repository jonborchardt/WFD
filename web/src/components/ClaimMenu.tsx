import { useState } from "react";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { IS_ADMIN } from "../lib/admin";

interface Props {
  claimId: string;
  hasOverride: boolean;
  onMutated?: () => void;
}

// Admin-only ⋯ menu on a claim row. Writes to aliases.json via the
// existing /api/aliases/ endpoints (claim-truth-override /
// claim-untruth-override / delete-claim / undelete-claim). Public mode
// collapses to nothing so the same render path works in production.
export function ClaimMenu({ claimId, hasOverride, onMutated }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!IS_ADMIN) return null;

  const close = () => setAnchor(null);

  async function post(action: string, extra: Record<string, string>) {
    const body = new URLSearchParams({ claimId, ...extra });
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

  async function handleOverride() {
    const v = prompt("truth value (0..1):", "0.5");
    if (v === null) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      alert("value must be a number in [0,1]");
      return;
    }
    const rationale = prompt("rationale (optional):", "") ?? "";
    await post("claim-truth-override", {
      directTruth: String(n),
      rationale,
    });
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ fontSize: "0.9rem" }}
        aria-label="claim actions"
      >
        ⋯
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem onClick={handleOverride}>override truth…</MenuItem>
        {hasOverride && (
          <MenuItem onClick={() => post("claim-untruth-override", {})}>
            revert truth override
          </MenuItem>
        )}
        <MenuItem onClick={() => post("delete-claim", {})}>delete claim</MenuItem>
        <MenuItem onClick={() => post("undelete-claim", {})}>
          undelete claim
        </MenuItem>
      </Menu>
    </>
  );
}
