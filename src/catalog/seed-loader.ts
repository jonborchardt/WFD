// Seed-file loader.
//
// Convention: a plain text file at data/seeds/videos.txt with one video id
// or YouTube url per line. `#` comments and blank lines are ignored. The
// loader is called once at UI boot; existing catalog rows are left alone,
// so the file can grow over time without re-triggering fetches for already
// ingested videos.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog, parseIdList } from "./catalog.js";

export function defaultSeedPath(): string {
  return join(process.cwd(), "data", "seeds", "videos.txt");
}

export interface SeedResult {
  path: string;
  exists: boolean;
  parsed: number;
  added: number;
}

export function loadSeedFile(catalog: Catalog, path = defaultSeedPath()): SeedResult {
  if (!existsSync(path)) {
    return { path, exists: false, parsed: 0, added: 0 };
  }
  const raw = readFileSync(path, "utf8");
  const entries = parseIdList(raw);
  const added = catalog.seed(entries);
  return { path, exists: true, parsed: entries.length, added };
}
