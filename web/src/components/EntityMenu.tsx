// Shared popover menu for per-entity and per-relationship actions.
// Two modes:
//
//   - Admin (VITE_ADMIN=true in dev / localhost): full action set.
//     Each action POSTs to /api/aliases/<op> directly and shows
//     inline success/error feedback so failed writes aren't silent.
//
//   - Public: one action — "suggest an edit" — that opens a GitHub
//     issue prefilled with structured fields + a localhost apply
//     link baked into the body.
//
// Triggers:
//   - Visible ⋯/✎ icon button (always present)
//   - shift+click anywhere on the entity chip or relationship row
//
// The popover renders through a React portal into document.body with
// position:fixed so it anchors correctly regardless of the parent's
// positioning context. This matters on the relationships page where
// the side panel has position:absolute.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { IS_ADMIN } from "../lib/admin";
import {
  hideEntityIssueUrl,
  renameEntityIssueUrl,
  mergeEntityIssueUrl,
  deleteRelationIssueUrl,
} from "../lib/issues";

export interface EntityRef {
  key: string;        // "person:dan"
  canonical: string;  // display text
  label: string;      // entity label
}

interface SearchResult {
  key: string;
  label: string;
  canonical: string;
  mentions: number;
  videos: number;
}

type PostResult = { ok: true } | { ok: false; error: string };

async function post(path: string, body: Record<string, string>): Promise<PostResult> {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const data = await r.json();
        if (data?.error) msg = data.error;
      } catch { /* ignore */ }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message + " (is the admin server running on :4173?)",
    };
  }
}

async function searchEntities(q: string, label: string): Promise<SearchResult[]> {
  const u = `/api/aliases/search?q=${encodeURIComponent(q)}&label=${encodeURIComponent(label)}`;
  try {
    const r = await fetch(u);
    if (!r.ok) return [];
    const data = await r.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ---- Popover shell ---------------------------------------------------

interface PopoverProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}

function Popover({ anchor, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Defer listener install so the click that opened the popover
    // doesn't immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", onEsc);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const rect = anchor?.getBoundingClientRect();
  // Fixed positioning so we anchor to the viewport, not whatever
  // positioned ancestor the trigger happens to be inside of.
  const style: React.CSSProperties = {
    position: "fixed",
    top: rect ? rect.bottom + 4 : 100,
    left: rect ? Math.min(rect.left, window.innerWidth - 320) : 100,
    zIndex: 10000,
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid #555",
    borderRadius: 4,
    padding: 6,
    minWidth: 280,
    maxWidth: 360,
    boxShadow: "0 4px 16px rgba(0,0,0,.5)",
    fontSize: 13,
  };

  return createPortal(
    <div ref={ref} style={style} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

// ---- Status banner inside the popover --------------------------------

interface StatusState {
  kind: "ok" | "error" | null;
  message: string;
}

function StatusBanner({ status }: { status: StatusState }) {
  if (!status.kind) return null;
  const bg = status.kind === "ok" ? "#1b5e20" : "#b71c1c";
  return (
    <div style={{ background: bg, color: "white", padding: "4px 6px", borderRadius: 3, marginTop: 4, fontSize: 12 }}>
      {status.kind === "ok" ? "✓ " : "✗ "}{status.message}
    </div>
  );
}

// ---- Entity menu ------------------------------------------------------

interface EntityMenuProps {
  entity: EntityRef;
  videoId?: string;        // enables per-video scope
  where: string;           // page identifier for issue context
  onApplied?: () => void;  // parent can refetch if needed
}

export function EntityMenuButton(props: EntityMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="entity actions"
        style={{
          border: "none", background: "none", cursor: "pointer",
          padding: "0 4px", fontSize: 14, color: "#888",
        }}
      >⋯</button>
      {open && btnRef.current && (
        <Popover anchor={btnRef.current} onClose={() => setOpen(false)}>
          {IS_ADMIN ? (
            <AdminEntityMenu
              entity={props.entity}
              videoId={props.videoId}
              onApplied={props.onApplied}
              onClose={() => setOpen(false)}
            />
          ) : (
            <PublicEntityMenu entity={props.entity} where={props.where} onClose={() => setOpen(false)} />
          )}
        </Popover>
      )}
    </>
  );
}

function AdminEntityMenu({
  entity,
  videoId,
  onApplied,
  onClose,
}: {
  entity: EntityRef;
  videoId?: string;
  onApplied?: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "rename" | "merge">("menu");
  const [status, setStatus] = useState<StatusState>({ kind: null, message: "" });

  async function applyAction(fn: () => Promise<PostResult>, successMsg: string) {
    const r = await fn();
    if (r.ok) {
      setStatus({ kind: "ok", message: successMsg });
      onApplied?.();
      setTimeout(onClose, 800);
    } else {
      setStatus({ kind: "error", message: r.error });
    }
  }

  const header = (
    <div style={{ padding: "4px 6px", borderBottom: "1px solid #555", marginBottom: 4 }}>
      <strong>{entity.canonical}</strong>
      <div style={{ fontSize: 11, color: "#aaa" }}>
        [{entity.label}] · <code>{entity.key}</code>
      </div>
    </div>
  );

  if (mode === "rename") {
    return (
      <div>
        {header}
        <RenameInput
          entity={entity}
          onSave={(v) => applyAction(
            () => post("/api/aliases/display", { key: entity.key, value: v }),
            `renamed display to "${v}"`,
          )}
          onCancel={() => setMode("menu")}
        />
        <StatusBanner status={status} />
      </div>
    );
  }

  if (mode === "merge") {
    return (
      <div>
        {header}
        <MergePicker
          entity={entity}
          videoId={videoId}
          onApply={applyAction}
          onCancel={() => setMode("menu")}
        />
        <StatusBanner status={status} />
      </div>
    );
  }

  return (
    <div>
      {header}
      <MenuItem onClick={() => applyAction(
        () => post("/api/aliases/hide", { key: entity.key }),
        "hidden",
      )}>hide entirely</MenuItem>
      <MenuItem onClick={() => setMode("rename")}>rename display…</MenuItem>
      <MenuItem onClick={() => setMode("merge")}>
        merge into… {videoId ? "(corpus or this video)" : ""}
      </MenuItem>
      <StatusBanner status={status} />
    </div>
  );
}

function PublicEntityMenu({
  entity,
  where,
  onClose,
}: { entity: EntityRef; where: string; onClose: () => void }) {
  const [action, setAction] = useState<"" | "rename" | "merge">("");
  const [renameText, setRenameText] = useState(entity.canonical);
  const header = (
    <div style={{ padding: "4px 6px", borderBottom: "1px solid #555", marginBottom: 4 }}>
      <strong>{entity.canonical}</strong>
      <div style={{ fontSize: 11, color: "#aaa" }}>[{entity.label}]</div>
    </div>
  );

  if (!action) {
    return (
      <div>
        {header}
        <MenuItem onClick={() => {
          window.open(hideEntityIssueUrl(entity, where), "_blank");
          onClose();
        }}>suggest: hide this entity</MenuItem>
        <MenuItem onClick={() => setAction("rename")}>suggest: rename display…</MenuItem>
        <MenuItem onClick={() => setAction("merge")}>suggest: merge into…</MenuItem>
      </div>
    );
  }

  if (action === "rename") {
    return (
      <div>
        {header}
        <div style={{ padding: "4px 6px" }}>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>Suggested display:</div>
          <input
            autoFocus
            type="text"
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <button onClick={() => {
              if (!renameText || renameText === entity.canonical) { onClose(); return; }
              window.open(renameEntityIssueUrl(entity, renameText, where), "_blank");
              onClose();
            }}>open issue</button>
            <button onClick={onClose}>cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <MergePickerPublic
        entity={entity}
        where={where}
        onCancel={onClose}
      />
    </div>
  );
}

function MergePicker({
  entity,
  videoId,
  onApply,
  onCancel,
}: {
  entity: EntityRef;
  videoId?: string;
  onApply: (fn: () => Promise<PostResult>, successMsg: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [scope, setScope] = useState<"corpus" | "video">("corpus");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchEntities(q.trim(), entity.label);
      if (!cancelled) setResults(r.filter((x) => x.key !== entity.key));
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, entity.label, entity.key]);

  const hasExact = results.some(
    (r) => r.canonical.toLowerCase() === q.trim().toLowerCase(),
  );

  const doMerge = useCallback((toKey: string, displayText: string) => {
    if (scope === "video" && videoId) {
      onApply(
        () => post("/api/aliases/video-merge", { videoId, from: entity.key, to: toKey }),
        `video merge → ${displayText}`,
      );
    } else {
      onApply(
        () => post("/api/aliases/merge", { from: entity.key, to: toKey }),
        `merged → ${displayText}`,
      );
    }
  }, [scope, videoId, entity.key, onApply]);

  const doCreatePhantom = useCallback((name: string) => {
    if (scope === "video") {
      alert("Per-video rename requires an existing target. Create it at corpus level first.");
      return;
    }
    onApply(
      () => post("/api/aliases/create-phantom", {
        label: entity.label, name, mergeFrom: entity.key,
      }),
      `merged → "${name}" (new)`,
    );
  }, [scope, entity.label, entity.key, onApply]);

  return (
    <div style={{ padding: "4px 6px" }}>
      {videoId && (
        <div style={{ fontSize: 11, margin: "2px 0" }}>
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={scope === "corpus"} onChange={() => setScope("corpus")} /> corpus
          </label>{" "}
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={scope === "video"} onChange={() => setScope("video")} /> this video only
          </label>
        </div>
      )}
      <input
        autoFocus
        type="text"
        placeholder="search same-label entities, or type a new name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={inputStyle}
      />
      <div style={{ maxHeight: 180, overflow: "auto", marginTop: 4 }}>
        {results.map((r) => (
          <div
            key={r.key}
            onClick={() => doMerge(r.key, r.canonical)}
            style={rowStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3a3a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            <strong>{r.canonical}</strong>{" "}
            <span style={{ fontSize: 11, color: "#aaa" }}>
              ({r.mentions} mentions, {r.videos} videos)
            </span>
          </div>
        ))}
        {q.trim() && !hasExact && (
          <div
            onClick={() => doCreatePhantom(q.trim())}
            style={{ ...rowStyle, borderTop: "1px dashed #555", marginTop: 4, color: "#4fc3f7" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3a3a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            + create new: <strong>"{q.trim()}"</strong>
          </div>
        )}
        {!q && results.length === 0 && (
          <div style={{ padding: 6, fontSize: 11, color: "#aaa" }}>type to search</div>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        <button onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
}

function MergePickerPublic({
  entity,
  where,
  onCancel,
}: {
  entity: EntityRef;
  where: string;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchEntities(q.trim(), entity.label);
      if (!cancelled) setResults(r.filter((x) => x.key !== entity.key));
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, entity.label, entity.key]);

  return (
    <div style={{ padding: "4px 6px" }}>
      <input
        autoFocus
        type="text"
        placeholder="search target entities…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={inputStyle}
      />
      <div style={{ maxHeight: 180, overflow: "auto", marginTop: 4 }}>
        {results.map((r) => (
          <div
            key={r.key}
            onClick={() => {
              const target: EntityRef = { key: r.key, canonical: r.canonical, label: r.label };
              window.open(mergeEntityIssueUrl(entity, target, where), "_blank");
              onCancel();
            }}
            style={rowStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3a3a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            <strong>{r.canonical}</strong>{" "}
            <span style={{ fontSize: 11, color: "#aaa" }}>
              ({r.mentions} mentions)
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 4 }}>
        <button onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
}

function RenameInput({
  entity,
  onSave,
  onCancel,
}: {
  entity: EntityRef;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(entity.canonical);
  return (
    <div style={{ padding: "4px 6px" }}>
      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>
        Display text (key unchanged):
      </div>
      <input
        autoFocus
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v !== entity.canonical) onSave(v); }}
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <button onClick={() => v !== entity.canonical && onSave(v)}>save</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 3 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#3a3a3a")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 4,
  border: "1px solid #555",
  borderRadius: 3,
  fontSize: 13,
  background: "#1a1a1a",
  color: "#eee",
  boxSizing: "border-box",
};

const rowStyle: React.CSSProperties = {
  padding: "4px 6px",
  cursor: "pointer",
  borderRadius: 3,
};

// ---- Relation menu ---------------------------------------------------

export interface RelationRef {
  subject: EntityRef;
  predicate: string;
  object: EntityRef;
  timeStart: number;
}

interface RelationMenuProps {
  videoId: string;
  relation: RelationRef;
  onApplied?: () => void;
}

export function RelationMenuButton(props: RelationMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="relationship actions"
        style={{
          border: "none", background: "none", cursor: "pointer",
          padding: "0 4px", fontSize: 13, color: "#888",
        }}
      >✎</button>
      {open && btnRef.current && (
        <Popover anchor={btnRef.current} onClose={() => setOpen(false)}>
          <RelationMenuBody
            {...props}
            onClose={() => setOpen(false)}
          />
        </Popover>
      )}
    </>
  );
}

function RelationMenuBody({
  videoId,
  relation,
  onApplied,
  onClose,
}: RelationMenuProps & { onClose: () => void }) {
  const [status, setStatus] = useState<StatusState>({ kind: null, message: "" });
  const compositeKey = `${relation.subject.key}|${relation.predicate}|${relation.object.key}|${Math.floor(relation.timeStart)}`;

  async function deleteRel() {
    const r = await post("/api/aliases/delete-relation", {
      videoId, key: compositeKey,
    });
    if (r.ok) {
      setStatus({ kind: "ok", message: "deleted in this video" });
      onApplied?.();
      setTimeout(onClose, 800);
    } else {
      setStatus({ kind: "error", message: r.error });
    }
  }

  return (
    <div>
      <div style={{ padding: "4px 6px", borderBottom: "1px solid #555", marginBottom: 4 }}>
        <strong>{relation.subject.canonical}</strong>{" "}
        <span style={{ color: "#aaa" }}>{relation.predicate}</span>{" "}
        <strong>{relation.object.canonical}</strong>
      </div>
      {IS_ADMIN ? (
        <MenuItem onClick={deleteRel}>delete this relationship (this video only)</MenuItem>
      ) : (
        <MenuItem onClick={() => {
          window.open(
            deleteRelationIssueUrl(
              videoId,
              relation.subject.key,
              relation.subject.canonical,
              relation.predicate,
              relation.object.key,
              relation.object.canonical,
              relation.timeStart,
            ),
            "_blank",
          );
          onClose();
        }}>suggest: delete this relationship</MenuItem>
      )}
      <StatusBanner status={status} />
    </div>
  );
}
