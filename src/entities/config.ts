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

  const labels =
    labelsFile && Array.isArray(labelsFile.labels)
      ? (labelsFile.labels as EntityLabel[])
      : DEFAULT.labels;

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

  return { labels, gliner, glirel, coref };
}
