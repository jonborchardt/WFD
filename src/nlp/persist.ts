// Persistent NLP artifacts on disk.
//
// Per-video `{entities, relationships}` get written to data/nlp/<videoId>.json
// by the nlp pipeline stage. The UI server reads from here instead of
// recomputing on every request. Treated as a derived cache that is regenerated
// whenever the upstream transcript is regenerated. There is no hand-edit
// sidecar — edits to NER output are not supported. Downstream refinement
// happens in the ai stage, whose bundles live under data/ai/.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Entity, Relationship, TranscriptSpan } from "../shared/types.js";

export interface PersistedNlp {
  entities: Entity[];
  relationships: Relationship[];
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
// Used to detect when entity-index.json / entity-videos.json are stale
// relative to any recomputed individual file.
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
