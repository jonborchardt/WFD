import { useState } from "react";
import { IconButton, Menu, MenuItem, Divider } from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { IS_ADMIN } from "../lib/admin";
import {
  claimTruthIssueUrl,
  claimFieldIssueUrl,
} from "../lib/issues";
import { ClaimEditDialog, type ClaimEditField } from "./ClaimEditDialog";
import { TruthOverrideDialog } from "./TruthOverrideDialog";

interface Props {
  claim: {
    id: string;
    videoId: string;
    text: string;
    directTruth?: number | null;
    kind?: string;
    hostStance?: string | null;
    rationale?: string;
  };
  hasOverride: boolean;
  onMutated?: () => void;
}

// Admin mode: direct POST to /api/aliases/. Public mode: open a
// prefilled GitHub issue the admin can one-click apply from localhost.
// Field edits go through a real MUI dialog (multi-line for text /
// rationale, select for kind / hostStance).
export function ClaimMenu({ claim, hasOverride, onMutated }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editField, setEditField] = useState<ClaimEditField | null>(null);
  const [truthOpen, setTruthOpen] = useState(false);
  const close = () => setAnchor(null);

  async function post(action: string, extra: Record<string, string>) {
    const body = new URLSearchParams({ claimId: claim.id, ...extra });
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

  function openField(field: ClaimEditField) {
    setEditField(field);
    close();
  }

  async function handleFieldSubmit(value: string) {
    if (!editField) return;
    const field = editField;
    setEditField(null);
    if (IS_ADMIN) {
      await post("claim-field-override", { [field]: value });
    } else {
      go(claimFieldIssueUrl(claim, field, value));
    }
  }

  async function handleTruthSubmit(truth: number, rationale: string) {
    setTruthOpen(false);
    if (IS_ADMIN) {
      await post("claim-truth-override", { directTruth: String(truth), rationale });
    } else {
      go(claimTruthIssueUrl(claim, truth, rationale));
    }
  }

  const initialFor = (field: ClaimEditField): string => {
    if (field === "text") return claim.text;
    if (field === "kind") return claim.kind ?? "empirical";
    if (field === "hostStance") return claim.hostStance ?? "";
    return claim.rationale ?? "";
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="edit claim"
      >
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem onClick={() => { setTruthOpen(true); close(); }}>
          {IS_ADMIN ? "override truth…" : "suggest truth…"}
        </MenuItem>
        {IS_ADMIN && hasOverride && (
          <MenuItem onClick={() => post("claim-untruth-override", {})}>
            revert truth override
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => openField("text")}>
          {IS_ADMIN ? "edit text…" : "suggest text…"}
        </MenuItem>
        <MenuItem onClick={() => openField("kind")}>
          {IS_ADMIN ? "edit kind…" : "suggest kind…"}
        </MenuItem>
        <MenuItem onClick={() => openField("hostStance")}>
          {IS_ADMIN ? "edit host stance…" : "suggest host stance…"}
        </MenuItem>
        <MenuItem onClick={() => openField("rationale")}>
          {IS_ADMIN ? "edit rationale…" : "suggest rationale…"}
        </MenuItem>
        {IS_ADMIN && (
          <MenuItem onClick={() => post("claim-field-unoverride", {})}>
            clear all field overrides
          </MenuItem>
        )}
        {IS_ADMIN && (
          <>
            <Divider />
            <MenuItem onClick={() => post("delete-claim", {})}>
              delete claim
            </MenuItem>
            <MenuItem onClick={() => post("undelete-claim", {})}>
              undelete claim
            </MenuItem>
          </>
        )}
      </Menu>

      {editField && (
        <ClaimEditDialog
          open
          field={editField}
          initialValue={initialFor(editField)}
          onCancel={() => setEditField(null)}
          onSubmit={handleFieldSubmit}
          mode={IS_ADMIN ? "admin" : "public"}
        />
      )}

      <TruthOverrideDialog
        open={truthOpen}
        initialTruth={claim.directTruth ?? 0.5}
        onCancel={() => setTruthOpen(false)}
        onSubmit={handleTruthSubmit}
        mode={IS_ADMIN ? "admin" : "public"}
      />
    </>
  );
}
