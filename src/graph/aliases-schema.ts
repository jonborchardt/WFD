// Aliases file schema (v2).
//
// Human-readable, AI-appendable structured JSON. Each override kind
// gets its own section so the file can be scanned by eye and AI can
// emit a new entry into a known array without constructing compound
// keys. Pure data — no metadata per entry.
//
// Flat v1 format (prefixed keys) is migrated on first load and
// written back in v2 format atomically.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasMap } from "./canonicalize.js";

export const ALIASES_SCHEMA_VERSION = 2;

export type EntityKey = string;  // "<label>:<normalized_canonical>"

export interface MergeEntry {
  from: EntityKey;
  to: EntityKey;
  // Optional human-readable reason for the merge. Written by AI audit or
  // operator; preserved through sort-on-write. Back-compat: older entries
  // have no rationale and continue to work.
  rationale?: string;
}

export interface DeletedEntityEntry {
  key: EntityKey;
  // Optional human-readable reason for the deletion. Written by
  // DELETE_ALWAYS auto-apply ("[music] cue tag", "role noun, not a
  // person") or by AI audit / operator. Back-compat: older entries
  // have no reason and continue to work.
  reason?: string;
}

export interface DisplayEntry {
  key: EntityKey;
  display: string;
}

export interface NotSameEntry {
  a: EntityKey;
  b: EntityKey;
}

export interface DismissedClusterEntry {
  members: EntityKey[];  // sorted
}

export interface VideoMergeEntry {
  videoId: string;
  from: EntityKey;
  to: EntityKey;
}

export interface DeletedRelationEntry {
  videoId: string;
  subject: EntityKey;
  predicate: string;
  object: EntityKey;
  timeStart: number;  // seconds, floored
}

// Operator-supplied truth anchor for a claim (Plan 5, Phase 4). Applied
// during the `claim-indexes` graph stage as a pinned directTruth before
// propagation.
export interface ClaimTruthOverrideEntry {
  claimId: string;
  directTruth: number;   // 0..1
  rationale?: string;
}

// Operator decision to hide a claim from the corpus-wide index entirely.
// The per-video claim file is never mutated; the claim is simply dropped
// at aggregation time.
export interface ClaimDeletionEntry {
  claimId: string;
}

// Operator override of text-style claim fields. Only fields the admin
// sets override the stored claim; omitted fields fall through to the
// on-disk value. Never mutates data/claims/<videoId>.json — the per-
// video file stays canonical source.
export interface ClaimFieldOverrideEntry {
  claimId: string;
  text?: string;
  kind?: string;          // one of ClaimKind values
  hostStance?: string;    // one of HostStance values
  rationale?: string;
}

// Operator decision to dismiss a detected contradiction. Keyed by the
// sorted pair of claim ids (so left/right order is canonical). Dismissed
// contradictions are filtered out of contradictions.json at aggregation
// time.
export interface ContradictionDismissalEntry {
  a: string;  // claim id, lo
  b: string;  // claim id, hi
  reason?: string;
}

// Operator-authored contradiction that the detector missed. Surfaced in
// contradictions.json with `kind: "manual"` and the operator's note.
export interface CustomContradictionEntry {
  a: string;           // claim id, lo
  b: string;           // claim id, hi
  summary: string;
  sharedEntities?: string[];
}

// Plan 05 §M4 — append-only audit log for every aliases mutation.
// Every mutator (addMerge, addDeletedEntity, …) writes one entry when
// invoked with an optional { batchId, by } context. Admin UI displays
// the most-recent ~50 in a "Recently applied" view on /admin/aliases.
export type AuditAction =
  | "merge"
  | "unmerge"
  | "delete-entity"
  | "undelete-entity"
  | "display"
  | "undisplay"
  | "not-same"
  | "dismissed"
  | "video-merge"
  | "video-unmerge"
  | "delete-relation"
  | "undelete-relation"
  | "claim-truth-override"
  | "claim-delete"
  | "claim-field-override"
  | "contradiction-dismissal"
  | "custom-contradiction";

export interface AuditLogEntry {
  at: string;                 // ISO timestamp
  action: AuditAction;
  // Free-form record; shape varies by action. The audit log is for
  // display/diagnosis, not for replay — operators who need to replay
  // should use the typed mutators against the specific state they
  // want.
  entry: Record<string, unknown>;
  /** Who initiated the write — "operator", "ai:<skill>", "pipeline:<stage>", … */
  by?: string;
  /** Optional batch id grouping related writes from one session. */
  batchId?: string;
}

export interface AliasesFile {
  schemaVersion: 2;
  merges: MergeEntry[];
  deletedEntities: DeletedEntityEntry[];
  display: DisplayEntry[];
  notSame: NotSameEntry[];
  dismissed: DismissedClusterEntry[];
  videoMerges: VideoMergeEntry[];
  deletedRelations: DeletedRelationEntry[];
  claimTruthOverrides: ClaimTruthOverrideEntry[];
  claimDeletions: ClaimDeletionEntry[];
  claimFieldOverrides: ClaimFieldOverrideEntry[];
  contradictionDismissals: ContradictionDismissalEntry[];
  customContradictions: CustomContradictionEntry[];
  /** Plan 05 §M4 — append-only audit log. Newest last. */
  auditLog?: AuditLogEntry[];
}

// Sentinels used internally in the flat AliasMap runtime rep. They
// never appear in the on-disk v2 file.
const DELETED = "__deleted__";
const NOT_SAME = "__not_same__";
const DISMISSED = "__dismissed__";
const TRUE = "true";

export function aliasesPath(dataDir: string): string {
  return join(dataDir, "aliases.json");
}

export function emptyAliasesFile(): AliasesFile {
  return {
    schemaVersion: 2,
    merges: [],
    deletedEntities: [],
    display: [],
    notSame: [],
    dismissed: [],
    videoMerges: [],
    deletedRelations: [],
    claimTruthOverrides: [],
    claimDeletions: [],
    claimFieldOverrides: [],
    contradictionDismissals: [],
    customContradictions: [],
    auditLog: [],
  };
}

// ---- Read / write ----------------------------------------------------

export function readAliasesFile(dataDir: string): AliasesFile {
  const p = aliasesPath(dataDir);
  if (!existsSync(p)) return emptyAliasesFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return emptyAliasesFile();
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj.schemaVersion === 2) return normalizeFile(obj as unknown as AliasesFile);
    // Legacy v1: flat Record<string, string>. Migrate and write back.
    const migrated = migrateFromFlat(obj as AliasMap);
    writeAliasesFile(dataDir, migrated);
    return migrated;
  }
  return emptyAliasesFile();
}

export function writeAliasesFile(dataDir: string, file: AliasesFile): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    aliasesPath(dataDir),
    JSON.stringify(sortFile(file), null, 2),
    "utf8",
  );
}

// Fill in any missing sections (e.g. after a manual edit deleted one)
// so all downstream code can assume arrays exist.
function normalizeFile(raw: Partial<AliasesFile>): AliasesFile {
  const empty = emptyAliasesFile();
  return {
    schemaVersion: 2,
    merges: raw.merges ?? empty.merges,
    deletedEntities: raw.deletedEntities ?? empty.deletedEntities,
    display: raw.display ?? empty.display,
    notSame: raw.notSame ?? empty.notSame,
    dismissed: raw.dismissed ?? empty.dismissed,
    videoMerges: raw.videoMerges ?? empty.videoMerges,
    deletedRelations: raw.deletedRelations ?? empty.deletedRelations,
    claimTruthOverrides: raw.claimTruthOverrides ?? empty.claimTruthOverrides,
    claimDeletions: raw.claimDeletions ?? empty.claimDeletions,
    claimFieldOverrides: raw.claimFieldOverrides ?? empty.claimFieldOverrides,
    contradictionDismissals: raw.contradictionDismissals ?? empty.contradictionDismissals,
    customContradictions: raw.customContradictions ?? empty.customContradictions,
    auditLog: raw.auditLog ?? [],
  };
}

// Plan 05 §M4 — append one entry to the audit log. Cheap on a tight
// rotation: we cap at MAX_AUDIT_ENTRIES so the aliases.json stays
// manageable and git diffs don't get swamped.
const MAX_AUDIT_ENTRIES = 500;
export function appendAuditLog(
  file: AliasesFile,
  action: AuditAction,
  entry: Record<string, unknown>,
  ctx?: { by?: string; batchId?: string },
): void {
  if (!file.auditLog) file.auditLog = [];
  file.auditLog.push({
    at: new Date().toISOString(),
    action,
    entry,
    by: ctx?.by,
    batchId: ctx?.batchId,
  });
  if (file.auditLog.length > MAX_AUDIT_ENTRIES) {
    file.auditLog = file.auditLog.slice(-MAX_AUDIT_ENTRIES);
  }
}

// Stable sort every section so diffs stay clean across edits.
function sortFile(file: AliasesFile): AliasesFile {
  return {
    schemaVersion: 2,
    merges: [...file.merges].sort((a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    ),
    deletedEntities: [...file.deletedEntities].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    display: [...file.display].sort((a, b) => a.key.localeCompare(b.key)),
    notSame: [...file.notSame]
      .map((e) => (e.a < e.b ? e : { a: e.b, b: e.a }))
      .sort((x, y) =>
        x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
      ),
    dismissed: [...file.dismissed]
      .map((e) => ({ members: [...e.members].sort() }))
      .sort((x, y) =>
        (x.members[0] ?? "").localeCompare(y.members[0] ?? ""),
      ),
    videoMerges: [...file.videoMerges].sort((a, b) =>
      a.videoId.localeCompare(b.videoId) ||
      a.from.localeCompare(b.from),
    ),
    deletedRelations: [...file.deletedRelations].sort((a, b) =>
      a.videoId.localeCompare(b.videoId) ||
      a.subject.localeCompare(b.subject) ||
      a.predicate.localeCompare(b.predicate) ||
      a.object.localeCompare(b.object) ||
      a.timeStart - b.timeStart,
    ),
    claimTruthOverrides: [...(file.claimTruthOverrides ?? [])].sort((a, b) =>
      a.claimId.localeCompare(b.claimId),
    ),
    claimDeletions: [...(file.claimDeletions ?? [])].sort((a, b) =>
      a.claimId.localeCompare(b.claimId),
    ),
    claimFieldOverrides: [...(file.claimFieldOverrides ?? [])].sort((a, b) =>
      a.claimId.localeCompare(b.claimId),
    ),
    contradictionDismissals: [...(file.contradictionDismissals ?? [])]
      .map((e) => (e.a < e.b ? e : { ...e, a: e.b, b: e.a }))
      .sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
    customContradictions: [...(file.customContradictions ?? [])]
      .map((e) => (e.a < e.b ? e : { ...e, a: e.b, b: e.a }))
      .sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
    // Audit log is append-only chronological — don't re-sort.
    auditLog: file.auditLog ? [...file.auditLog] : [],
  };
}

// ---- Migration v1 (flat prefixed keys) → v2 (sectioned) --------------

export function migrateFromFlat(flat: AliasMap): AliasesFile {
  const out = emptyAliasesFile();
  for (const [k, v] of Object.entries(flat)) {
    if (typeof v !== "string") continue;
    // display:<entityKey> → display section
    if (k.startsWith("display:")) {
      out.display.push({ key: k.slice("display:".length), display: v });
      continue;
    }
    // video:<vid>:<from> → videoMerges
    if (k.startsWith("video:")) {
      const rest = k.slice("video:".length);
      const colon = rest.indexOf(":");
      if (colon < 0) continue;
      const videoId = rest.slice(0, colon);
      const from = rest.slice(colon + 1);
      out.videoMerges.push({ videoId, from, to: v });
      continue;
    }
    // del:<vid>:<subject>|<predicate>|<object>|<timeStart> → deletedRelations
    if (k.startsWith("del:")) {
      const rest = k.slice("del:".length);
      const colon = rest.indexOf(":");
      if (colon < 0) continue;
      const videoId = rest.slice(0, colon);
      const composite = rest.slice(colon + 1);
      const parts = composite.split("|");
      if (parts.length < 4) continue;
      // Object key may contain `|` if it's from an odd canonical, so
      // rebuild: first is subject, last is timeStart, second is
      // predicate, everything between is object.
      const subject = parts[0];
      const predicate = parts[1];
      const timeStart = Number(parts[parts.length - 1]);
      const object = parts.slice(2, parts.length - 1).join("|");
      if (!isFinite(timeStart)) continue;
      out.deletedRelations.push({ videoId, subject, predicate, object, timeStart });
      continue;
    }
    // <a>~~<b> → notSame (only when value is NOT_SAME)
    if (k.includes("~~") && v === NOT_SAME) {
      const [a, b] = k.split("~~");
      if (a && b) out.notSame.push({ a, b });
      continue;
    }
    // <key1>||<key2>||... → dismissed cluster (value is DISMISSED or __rejected__ legacy)
    if (k.includes("||") && (v === DISMISSED || v === "__rejected__")) {
      const members = k.split("||").filter(Boolean);
      if (members.length >= 2) out.dismissed.push({ members });
      continue;
    }
    // Skip stray ~~/|| with non-sentinel values.
    if (k.includes("~~") || k.includes("||")) continue;
    // Entity key with a sentinel value → deletedEntities (fold old __hidden__ too).
    if (v === "__hidden__" || v === DELETED) {
      out.deletedEntities.push({ key: k });
      continue;
    }
    // Entity key → target key → merges.
    if (v && !isPlainSentinel(v)) {
      out.merges.push({ from: k, to: v });
      continue;
    }
  }
  return sortFile(out);
}

function isPlainSentinel(v: string): boolean {
  return (
    v === DELETED ||
    v === NOT_SAME ||
    v === DISMISSED ||
    v === "__hidden__" ||
    v === "__rejected__"
  );
}

// ---- Flat AliasMap for runtime consumers -----------------------------
//
// The adapter and the canonicalize helpers (resolveKey, isDeleted,
// isRelationDeleted, getDisplayOverride, getVideoAlias) take a flat
// Map. We keep that API stable; this function builds it from the
// structured file.

export function buildAliasMap(file: AliasesFile): AliasMap {
  const m: AliasMap = {};
  for (const e of file.merges) m[e.from] = e.to;
  for (const e of file.deletedEntities) m[e.key] = DELETED;
  for (const e of file.display) m[`display:${e.key}`] = e.display;
  for (const e of file.notSame) {
    const key = e.a < e.b ? `${e.a}~~${e.b}` : `${e.b}~~${e.a}`;
    m[key] = NOT_SAME;
  }
  for (const e of file.dismissed) {
    const key = [...e.members].sort().join("||");
    m[key] = DISMISSED;
  }
  for (const e of file.videoMerges) {
    m[`video:${e.videoId}:${e.from}`] = e.to;
  }
  for (const e of file.deletedRelations) {
    m[`del:${e.videoId}:${e.subject}|${e.predicate}|${e.object}|${Math.floor(e.timeStart)}`] = TRUE;
  }
  return m;
}

// ---- Mutating helpers -----------------------------------------------
//
// Each helper does a read-modify-write with stable sort. Callers don't
// have to juggle file state; they pass in the action data and we
// persist.

function mutate(dataDir: string, fn: (f: AliasesFile) => void): AliasesFile {
  const f = readAliasesFile(dataDir);
  fn(f);
  writeAliasesFile(dataDir, f);
  return f;
}

export function addMerge(
  dataDir: string,
  from: EntityKey,
  to: EntityKey,
  rationale?: string,
): void {
  mutate(dataDir, (f) => {
    f.merges = f.merges.filter((e) => e.from !== from);
    const entry: MergeEntry = { from, to };
    if (rationale && rationale.trim()) entry.rationale = rationale.trim();
    f.merges.push(entry);
  });
}

export function removeMerge(dataDir: string, from: EntityKey): void {
  mutate(dataDir, (f) => {
    f.merges = f.merges.filter((e) => e.from !== from);
  });
}

export function addDeletedEntity(
  dataDir: string,
  key: EntityKey,
  reason?: string,
): void {
  mutate(dataDir, (f) => {
    // If the entity was merged anywhere, drop that merge before marking
    // it deleted so the sentinel wins.
    f.merges = f.merges.filter((e) => e.from !== key);
    const existing = f.deletedEntities.find((e) => e.key === key);
    if (existing) {
      if (reason && reason.trim() && !existing.reason) {
        existing.reason = reason.trim();
      }
      return;
    }
    const entry: DeletedEntityEntry = { key };
    if (reason && reason.trim()) entry.reason = reason.trim();
    f.deletedEntities.push(entry);
  });
}

export function removeDeletedEntity(dataDir: string, key: EntityKey): void {
  mutate(dataDir, (f) => {
    f.deletedEntities = f.deletedEntities.filter((e) => e.key !== key);
  });
}

export function addDisplay(dataDir: string, key: EntityKey, display: string): void {
  mutate(dataDir, (f) => {
    f.display = f.display.filter((e) => e.key !== key);
    f.display.push({ key, display });
  });
}

export function removeDisplay(dataDir: string, key: EntityKey): void {
  mutate(dataDir, (f) => {
    f.display = f.display.filter((e) => e.key !== key);
  });
}

export function addNotSame(dataDir: string, a: EntityKey, b: EntityKey): void {
  mutate(dataDir, (f) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (!f.notSame.some((e) => e.a === lo && e.b === hi)) {
      f.notSame.push({ a: lo, b: hi });
    }
  });
}

export function addDismissed(dataDir: string, members: EntityKey[]): void {
  mutate(dataDir, (f) => {
    const sorted = [...members].sort();
    const key = sorted.join("||");
    if (!f.dismissed.some((e) => [...e.members].sort().join("||") === key)) {
      f.dismissed.push({ members: sorted });
    }
  });
}

export function addVideoMerge(
  dataDir: string,
  videoId: string,
  from: EntityKey,
  to: EntityKey,
): void {
  mutate(dataDir, (f) => {
    f.videoMerges = f.videoMerges.filter(
      (e) => !(e.videoId === videoId && e.from === from),
    );
    f.videoMerges.push({ videoId, from, to });
  });
}

export function removeVideoMerge(
  dataDir: string,
  videoId: string,
  from: EntityKey,
): void {
  mutate(dataDir, (f) => {
    f.videoMerges = f.videoMerges.filter(
      (e) => !(e.videoId === videoId && e.from === from),
    );
  });
}

export function addDeletedRelation(
  dataDir: string,
  videoId: string,
  subject: EntityKey,
  predicate: string,
  object: EntityKey,
  timeStart: number,
): void {
  const ts = Math.floor(timeStart);
  mutate(dataDir, (f) => {
    const dup = f.deletedRelations.some(
      (e) =>
        e.videoId === videoId &&
        e.subject === subject &&
        e.predicate === predicate &&
        e.object === object &&
        e.timeStart === ts,
    );
    if (!dup) {
      f.deletedRelations.push({ videoId, subject, predicate, object, timeStart: ts });
    }
  });
}

export function removeDeletedRelation(
  dataDir: string,
  videoId: string,
  subject: EntityKey,
  predicate: string,
  object: EntityKey,
  timeStart: number,
): void {
  const ts = Math.floor(timeStart);
  mutate(dataDir, (f) => {
    f.deletedRelations = f.deletedRelations.filter(
      (e) =>
        !(
          e.videoId === videoId &&
          e.subject === subject &&
          e.predicate === predicate &&
          e.object === object &&
          e.timeStart === ts
        ),
    );
  });
}

export function addClaimTruthOverride(
  dataDir: string,
  claimId: string,
  directTruth: number,
  rationale?: string,
): void {
  if (!(directTruth >= 0 && directTruth <= 1)) {
    throw new Error(`directTruth ${directTruth} not in [0,1]`);
  }
  mutate(dataDir, (f) => {
    f.claimTruthOverrides = f.claimTruthOverrides.filter(
      (e) => e.claimId !== claimId,
    );
    const entry: ClaimTruthOverrideEntry = { claimId, directTruth };
    if (rationale !== undefined && rationale !== "") entry.rationale = rationale;
    f.claimTruthOverrides.push(entry);
  });
}

export function removeClaimTruthOverride(
  dataDir: string,
  claimId: string,
): void {
  mutate(dataDir, (f) => {
    f.claimTruthOverrides = f.claimTruthOverrides.filter(
      (e) => e.claimId !== claimId,
    );
  });
}

export function addClaimDeletion(dataDir: string, claimId: string): void {
  mutate(dataDir, (f) => {
    if (!f.claimDeletions.some((e) => e.claimId === claimId)) {
      f.claimDeletions.push({ claimId });
    }
  });
}

export function removeClaimDeletion(dataDir: string, claimId: string): void {
  mutate(dataDir, (f) => {
    f.claimDeletions = f.claimDeletions.filter((e) => e.claimId !== claimId);
  });
}

// Merge fields into an existing override record, or create a new one.
// `patch` may contain any subset of the override-able fields; anything
// absent is left unchanged on the existing record.
export function setClaimFieldOverride(
  dataDir: string,
  claimId: string,
  patch: Partial<Omit<ClaimFieldOverrideEntry, "claimId">>,
): void {
  mutate(dataDir, (f) => {
    const existing = f.claimFieldOverrides.find((e) => e.claimId === claimId);
    const merged: ClaimFieldOverrideEntry = { ...(existing ?? { claimId }), ...patch, claimId };
    // Drop empty-string fields so the override doesn't accidentally
    // overwrite an on-disk value with emptiness.
    for (const k of ["text", "kind", "hostStance", "rationale"] as const) {
      if (merged[k] !== undefined && (merged[k] as string).trim() === "") {
        delete merged[k];
      }
    }
    f.claimFieldOverrides = f.claimFieldOverrides.filter((e) => e.claimId !== claimId);
    // Only write the entry if it contains at least one override field.
    const hasContent =
      merged.text !== undefined ||
      merged.kind !== undefined ||
      merged.hostStance !== undefined ||
      merged.rationale !== undefined;
    if (hasContent) f.claimFieldOverrides.push(merged);
  });
}

export function removeClaimFieldOverride(dataDir: string, claimId: string): void {
  mutate(dataDir, (f) => {
    f.claimFieldOverrides = f.claimFieldOverrides.filter((e) => e.claimId !== claimId);
  });
}

function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function addContradictionDismissal(
  dataDir: string,
  a: string,
  b: string,
  reason?: string,
): void {
  const [lo, hi] = sortedPair(a, b);
  mutate(dataDir, (f) => {
    f.contradictionDismissals = f.contradictionDismissals.filter(
      (e) => !(e.a === lo && e.b === hi),
    );
    const entry: ContradictionDismissalEntry = { a: lo, b: hi };
    if (reason && reason.trim()) entry.reason = reason;
    f.contradictionDismissals.push(entry);
  });
}

export function removeContradictionDismissal(
  dataDir: string,
  a: string,
  b: string,
): void {
  const [lo, hi] = sortedPair(a, b);
  mutate(dataDir, (f) => {
    f.contradictionDismissals = f.contradictionDismissals.filter(
      (e) => !(e.a === lo && e.b === hi),
    );
  });
}

export function addCustomContradiction(
  dataDir: string,
  a: string,
  b: string,
  summary: string,
  sharedEntities?: string[],
): void {
  const [lo, hi] = sortedPair(a, b);
  mutate(dataDir, (f) => {
    f.customContradictions = f.customContradictions.filter(
      (e) => !(e.a === lo && e.b === hi),
    );
    const entry: CustomContradictionEntry = { a: lo, b: hi, summary };
    if (sharedEntities && sharedEntities.length > 0) {
      entry.sharedEntities = [...new Set(sharedEntities)].sort();
    }
    f.customContradictions.push(entry);
  });
}

export function removeCustomContradiction(
  dataDir: string,
  a: string,
  b: string,
): void {
  const [lo, hi] = sortedPair(a, b);
  mutate(dataDir, (f) => {
    f.customContradictions = f.customContradictions.filter(
      (e) => !(e.a === lo && e.b === hi),
    );
  });
}
