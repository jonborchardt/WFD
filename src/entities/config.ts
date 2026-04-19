// Runtime configuration loader for the new entities stage.
//
// Reads config/entity-labels.json and config/models.json from the repo
// root. Both files ship with the source tree and are the authoritative
// runtime knobs — edits here do not require a code change. Tests that
// need deterministic configuration can pass their own objects directly
// and skip this loader.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EntityLabel } from "./types.js";

export interface LoadedConfig {
  labels: EntityLabel[];
  hiddenLabels: EntityLabel[];
  gliner: {
    modelId: string;
    minScore: number;
    maxChunkChars: number;
  };
  glirel: {
    modelId: string;
    minScore: number;
    maxPairsPerSentence: number;
  };
  coref: {
    enabled: boolean;
    pythonBin: string;
    scriptPath: string;
    timeoutMs: number;
  };
}

const DEFAULT: LoadedConfig = {
  labels: [
    "person",
    "organization",
    "group_or_movement",
    "location",
    "facility",
    "event",
    "date_time",
    "role",
    "technology",
    "work_of_media",
    "law_or_policy",
    "ideology",
    "nationality_or_ethnicity",
    "quantity",
  ],
  hiddenLabels: ["quantity"],
  gliner: {
    modelId: "urchade/gliner_large-v2.1",
    minScore: 0.5,
    maxChunkChars: 1200,
  },
  glirel: {
    modelId: "jackboyla/glirel_large",
    minScore: 0.5,
    maxPairsPerSentence: 10,
  },
  coref: {
    enabled: true,
    pythonBin: "python",
    scriptPath: "tools/coref.py",
    timeoutMs: 120_000,
  },
};

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function loadConfig(repoRoot: string = process.cwd()): LoadedConfig {
  const labelsFile = readJson(resolve(repoRoot, "config/entity-labels.json"));
  const modelsFile = readJson(resolve(repoRoot, "config/models.json"));

  const parsed = parseLabelEntries(labelsFile?.labels);
  const labels = parsed ? parsed.labels : DEFAULT.labels;
  const hiddenLabels = parsed ? parsed.hiddenLabels : DEFAULT.hiddenLabels;

  const gliner = {
    ...DEFAULT.gliner,
    ...((modelsFile?.gliner as Partial<LoadedConfig["gliner"]>) ?? {}),
  };
  const glirel = {
    ...DEFAULT.glirel,
    ...((modelsFile?.glirel as Partial<LoadedConfig["glirel"]>) ?? {}),
  };
  const coref = {
    ...DEFAULT.coref,
    ...((modelsFile?.coref as Partial<LoadedConfig["coref"]>) ?? {}),
  };

  return { labels, hiddenLabels, gliner, glirel, coref };
}

// config/entity-labels.json now holds `{ name, hidden? }` objects. A hidden
// label is still passed to GLiNER (so it can still be the object of a
// relationship like `works_for → "5 million"`), but the UI hides it from
// facets, search, graph, and per-video entity lists.
function parseLabelEntries(raw: unknown):
  | { labels: EntityLabel[]; hiddenLabels: EntityLabel[] }
  | null {
  if (!Array.isArray(raw)) return null;
  const labels: EntityLabel[] = [];
  const hiddenLabels: EntityLabel[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const obj = entry as { name?: unknown; hidden?: unknown };
    if (typeof obj.name !== "string") return null;
    const name = obj.name as EntityLabel;
    labels.push(name);
    if (obj.hidden === true) hiddenLabels.push(name);
  }
  return { labels, hiddenLabels };
}
