// On-disk persistence for the new entities stage. Writes one file per
// video under data/entities/<videoId>.json. Kept separate from the
// extractor so tests can persist synthetic fixtures without running a
// model.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PersistedEntities } from "./types.js";

export function entitiesDir(dataDir: string): string {
  return join(dataDir, "entities");
}

export function entitiesPath(videoId: string, dataDir: string): string {
  return join(entitiesDir(dataDir), `${videoId}.json`);
}

export function writePersistedEntities(
  videoId: string,
  payload: PersistedEntities,
  dataDir: string,
): string {
  const dir = entitiesDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = entitiesPath(videoId, dataDir);
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

export function readPersistedEntities(
  videoId: string,
  dataDir: string,
): PersistedEntities | null {
  const path = entitiesPath(videoId, dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedEntities;
  } catch {
    return null;
  }
}
