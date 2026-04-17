// Corpus-wide entity index persistence. Previously lived in
// src/nlp/persist.ts alongside the per-video nlp blobs; now migrated
// here because the neural pipeline writes per-video data under
// data/entities/ and data/relations/, and the aggregated index is a
// cross-cutting concern consumed by the UI.
//
// On-disk files:
//   data/entities/entity-index.json   → aggregated EntityIndexEntry[]
//   data/entities/entity-videos.json  → per-entity video+mentions map
//
// Both are derived caches. They are stale when any per-video entities
// file has a newer mtime — callers check and rebuild on demand.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Entity, TranscriptSpan } from "../shared/types.js";

export interface EntityIndexEntry {
  id: string;
  type: Entity["type"];
  canonical: string;
  videoCount: number;
  mentionCount: number;
}

export interface EntityVideoRef {
  videoId: string;
  mentions: TranscriptSpan[];
}

export type EntityVideosIndex = Record<string, EntityVideoRef[]>;

function entitiesDir(dataDir?: string): string {
  return join(dataDir ?? join(process.cwd(), "data"), "entities");
}

export function entityIndexPath(dataDir?: string): string {
  return join(entitiesDir(dataDir), "entity-index.json");
}

export function entityVideosPath(dataDir?: string): string {
  return join(entitiesDir(dataDir), "entity-videos.json");
}

function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

const AGGREGATE_FILES = new Set(["entity-index.json", "entity-videos.json"]);

// Max mtime across the per-video entities files, excluding aggregates.
// Used to detect when the index files are stale relative to any
// recomputed per-video file.
function maxPerVideoEntitiesMtime(dataDir?: string): number {
  const dir = entitiesDir(dataDir);
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const name of readdirSync(dir)) {
    if (AGGREGATE_FILES.has(name)) continue;
    if (!name.endsWith(".json")) continue;
    const m = mtime(join(dir, name));
    if (m > max) max = m;
  }
  return max;
}

export function readPersistedEntityIndex(
  dataDir?: string,
): EntityIndexEntry[] | null {
  const p = entityIndexPath(dataDir);
  if (!existsSync(p)) return null;
  if (maxPerVideoEntitiesMtime(dataDir) > mtime(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as EntityIndexEntry[];
  } catch {
    return null;
  }
}

export function writePersistedEntityIndex(
  entries: EntityIndexEntry[],
  dataDir?: string,
): void {
  const p = entityIndexPath(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(entries), "utf8");
}

export function readPersistedEntityVideos(
  dataDir?: string,
): EntityVideosIndex | null {
  const p = entityVideosPath(dataDir);
  if (!existsSync(p)) return null;
  if (maxPerVideoEntitiesMtime(dataDir) > mtime(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as EntityVideosIndex;
  } catch {
    return null;
  }
}

export function writePersistedEntityVideos(
  index: EntityVideosIndex,
  dataDir?: string,
): void {
  const p = entityVideosPath(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(index), "utf8");
}
