// On-disk persistence for the date-normalize stage. Writes one file per
// video under data/date-normalize/<videoId>.json. The entities file is
// never mutated; this sidecar is merged by src/graph/adapt.ts at
// graph-build time.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistedDerivedDates } from "./types.js";

export function derivedDatesDir(dataDir: string): string {
  return join(dataDir, "date-normalize");
}

export function derivedDatesPath(videoId: string, dataDir: string): string {
  return join(derivedDatesDir(dataDir), `${videoId}.json`);
}

export function writePersistedDerivedDates(
  videoId: string,
  payload: PersistedDerivedDates,
  dataDir: string,
): string {
  const dir = derivedDatesDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = derivedDatesPath(videoId, dataDir);
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

export function readPersistedDerivedDates(
  videoId: string,
  dataDir: string,
): PersistedDerivedDates | null {
  const path = derivedDatesPath(videoId, dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedDerivedDates;
  } catch {
    return null;
  }
}
