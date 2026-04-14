// Persistent NLP artifacts on disk.
//
// Per-video `{entities, relationships}` get written to data/nlp/<videoId>.json
// by the build-nlp script. The UI server reads from here instead of recomputing
// on every request. Treated as a derived cache: safe to delete and rebuild.
//
// Overlay sidecar: data/nlp/<videoId>.overlay.json holds hand-authored deltas
// (addEntities / removeEntities / addRelationships / removeRelationships) that
// the pipeline MUST NEVER write to. The auto file is freely overwritten on
// re-run; user edits live in the overlay and survive every re-run. Consumers
// should call readMergedNlp() to see the effective view (auto ∪ adds − removes).

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Entity, Relationship, TranscriptSpan } from "../shared/types.js";

export interface PersistedNlp {
  entities: Entity[];
  relationships: Relationship[];
}

export interface NlpOverlay {
  addEntities: Entity[];
  removeEntities: Array<{ id: string }>;
  addRelationships: Relationship[];
  removeRelationships: Array<{ id: string }>;
  note?: string;
}

export function emptyOverlay(): NlpOverlay {
  return {
    addEntities: [],
    removeEntities: [],
    addRelationships: [],
    removeRelationships: [],
  };
}

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

function nlpDir(dataDir?: string): string {
  return join(dataDir ?? join(process.cwd(), "data"), "nlp");
}

function transcriptsDir(dataDir?: string): string {
  return join(dataDir ?? join(process.cwd(), "data"), "transcripts");
}

export function nlpPath(videoId: string, dataDir?: string): string {
  return join(nlpDir(dataDir), `${videoId}.json`);
}

export function nlpOverlayPath(videoId: string, dataDir?: string): string {
  return join(nlpDir(dataDir), `${videoId}.overlay.json`);
}

export function entityIndexPath(dataDir?: string): string {
  return join(nlpDir(dataDir), "entity-index.json");
}

export function entityVideosPath(dataDir?: string): string {
  return join(nlpDir(dataDir), "entity-videos.json");
}

function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

const AGGREGATE_FILES = new Set(["entity-index.json", "entity-videos.json"]);

// Max mtime across the per-video NLP files in data/nlp/, excluding aggregates.
// Includes overlay sidecars so editing an overlay invalidates the aggregates.
function maxPerVideoNlpMtime(dataDir?: string): number {
  const dir = nlpDir(dataDir);
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

export function readPersistedNlp(
  videoId: string,
  dataDir?: string,
): PersistedNlp | null {
  const p = nlpPath(videoId, dataDir);
  if (!existsSync(p)) return null;
  const transcriptFile = join(transcriptsDir(dataDir), `${videoId}.json`);
  if (mtime(transcriptFile) > mtime(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PersistedNlp;
  } catch {
    return null;
  }
}

export function writePersistedNlp(
  videoId: string,
  nlp: PersistedNlp,
  dataDir?: string,
): void {
  const p = nlpPath(videoId, dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(nlp), "utf8");
}

// Read the hand-authored overlay for a video. Returns null when no overlay
// exists on disk. The pipeline MUST NOT call writeNlpOverlay — the overlay
// is only written by the admin UI / manual edits.
export function readNlpOverlay(
  videoId: string,
  dataDir?: string,
): NlpOverlay | null {
  const p = nlpOverlayPath(videoId, dataDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<NlpOverlay>;
    return {
      addEntities: raw.addEntities ?? [],
      removeEntities: raw.removeEntities ?? [],
      addRelationships: raw.addRelationships ?? [],
      removeRelationships: raw.removeRelationships ?? [],
      note: raw.note,
    };
  } catch {
    return null;
  }
}

export function writeNlpOverlay(
  videoId: string,
  overlay: NlpOverlay,
  dataDir?: string,
): void {
  const p = nlpOverlayPath(videoId, dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(overlay, null, 2), "utf8");
}

// Merge auto NLP output with a hand-authored overlay to produce the
// effective view consumers should see: (auto ∪ adds) − removes. Overlay
// adds that collide with an auto entity (same id) replace the auto entry so
// hand-edited canonical/aliases/mentions win. Removes are matched on entity
// or relationship id.
export function mergeNlpWithOverlay(
  nlp: PersistedNlp,
  overlay: NlpOverlay | null,
): PersistedNlp {
  if (!overlay) return nlp;
  const removedEntities = new Set(overlay.removeEntities.map((r) => r.id));
  const removedRelationships = new Set(
    overlay.removeRelationships.map((r) => r.id),
  );
  const entityMap = new Map<string, Entity>();
  for (const e of nlp.entities) {
    if (removedEntities.has(e.id)) continue;
    entityMap.set(e.id, e);
  }
  for (const e of overlay.addEntities) {
    if (removedEntities.has(e.id)) continue;
    entityMap.set(e.id, e);
  }
  const relMap = new Map<string, Relationship>();
  for (const r of nlp.relationships) {
    if (removedRelationships.has(r.id)) continue;
    relMap.set(r.id, r);
  }
  for (const r of overlay.addRelationships) {
    if (removedRelationships.has(r.id)) continue;
    relMap.set(r.id, r);
  }
  return {
    entities: [...entityMap.values()],
    relationships: [...relMap.values()],
  };
}

// Convenience: read the auto file and overlay together and return the
// merged effective view. Null when the auto file is missing.
export function readMergedNlp(
  videoId: string,
  dataDir?: string,
): PersistedNlp | null {
  const base = readPersistedNlp(videoId, dataDir);
  if (!base) return null;
  const overlay = readNlpOverlay(videoId, dataDir);
  return mergeNlpWithOverlay(base, overlay);
}

export function readPersistedEntityIndex(
  dataDir?: string,
): EntityIndexEntry[] | null {
  const p = entityIndexPath(dataDir);
  if (!existsSync(p)) return null;
  if (maxPerVideoNlpMtime(dataDir) > mtime(p)) return null;
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
  if (maxPerVideoNlpMtime(dataDir) > mtime(p)) return null;
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
