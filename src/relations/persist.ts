// On-disk persistence for the relations stage. Writes one file per video
// under data/relations/<videoId>.json. Mirror of src/entities/persist.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PersistedRelations } from "./types.js";

export function relationsDir(dataDir: string): string {
  return join(dataDir, "relations");
}

export function relationsPath(videoId: string, dataDir: string): string {
  return join(relationsDir(dataDir), `${videoId}.json`);
}

export function writePersistedRelations(
  videoId: string,
  payload: PersistedRelations,
  dataDir: string,
): string {
  const dir = relationsDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = relationsPath(videoId, dataDir);
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

export function readPersistedRelations(
  videoId: string,
  dataDir: string,
): PersistedRelations | null {
  const path = relationsPath(videoId, dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedRelations;
  } catch {
    return null;
  }
}
