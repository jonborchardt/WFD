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
}

export interface DeletedEntityEntry {
  key: EntityKey;
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

export interface AliasesFile {
  schemaVersion: 2;
  merges: MergeEntry[];
  deletedEntities: DeletedEntityEntry[];
  display: DisplayEntry[];
  notSame: NotSameEntry[];
  dismissed: DismissedClusterEntry[];
  videoMerges: VideoMergeEntry[];
  deletedRelations: DeletedRelationEntry[];
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
  };
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

export function addMerge(dataDir: string, from: EntityKey, to: EntityKey): void {
  mutate(dataDir, (f) => {
    f.merges = f.merges.filter((e) => e.from !== from);
    f.merges.push({ from, to });
  });
}

export function removeMerge(dataDir: string, from: EntityKey): void {
  mutate(dataDir, (f) => {
    f.merges = f.merges.filter((e) => e.from !== from);
  });
}

export function addDeletedEntity(dataDir: string, key: EntityKey): void {
  mutate(dataDir, (f) => {
    // If the entity was merged anywhere, drop that merge before marking
    // it deleted so the sentinel wins.
    f.merges = f.merges.filter((e) => e.from !== key);
    if (!f.deletedEntities.some((e) => e.key === key)) {
      f.deletedEntities.push({ key });
    }
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
