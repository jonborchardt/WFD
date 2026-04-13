// Filesystem-backed gazetteer loader.
//
// Reads plain text files under data/gazetteer/{organization,location,event,thing}.txt
// (one term per line, lines starting with "#" or blank lines skipped). The
// loaded map merges with the in-code DEFAULT_GAZETTEER so callers that pass
// no override still get the seed list if the files are absent.
//
// Cached on first read — gazetteer files are small and static per process.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_GAZETTEER, GazetteerMap } from "./entities.js";

let cached: GazetteerMap | null = null;
let cachedRoot: string | null = null;

function parseList(path: string): string[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.push(line);
  }
  return out;
}

function uniq(parts: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of parts) {
    for (const term of list) {
      const k = term.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(term);
    }
  }
  return out;
}

export function loadGazetteer(dataDir = "data"): GazetteerMap {
  if (cached && cachedRoot === dataDir) return cached;
  const root = join(dataDir, "gazetteer");
  const merged: GazetteerMap = {
    organization: uniq([DEFAULT_GAZETTEER.organization, parseList(join(root, "organization.txt"))]),
    location: uniq([DEFAULT_GAZETTEER.location, parseList(join(root, "location.txt"))]),
    event: uniq([DEFAULT_GAZETTEER.event, parseList(join(root, "event.txt"))]),
    thing: uniq([DEFAULT_GAZETTEER.thing, parseList(join(root, "thing.txt"))]),
  };
  cached = merged;
  cachedRoot = dataDir;
  return merged;
}

export function resetGazetteerCache(): void {
  cached = null;
  cachedRoot = null;
}
