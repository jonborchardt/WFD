// Relations stage config loader. Reads config/relation-labels.json
// alongside the shared models.json so the predicate list and
// per-predicate thresholds are editable without touching code.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PredicateConfig } from "./types.js";

export interface LoadedRelationsConfig {
  predicates: PredicateConfig[];
  glirel: {
    modelId: string;
    minScore: number;
    maxPairsPerSentence: number;
  };
}

const DEFAULT: LoadedRelationsConfig = {
  predicates: [
    { name: "works_for",       threshold: 0.5  },
    { name: "founded",         threshold: 0.5  },
    { name: "member_of",       threshold: 0.5  },
    { name: "led_by",          threshold: 0.5  },
    { name: "located_in",      threshold: 0.5  },
    { name: "born_in",         threshold: 0.55 },
    { name: "died_in",         threshold: 0.55 },
    { name: "operates_in",     threshold: 0.5  },
    { name: "met_with",        threshold: 0.55 },
    { name: "allied_with",     threshold: 0.55 },
    { name: "opposed_by",      threshold: 0.55 },
    { name: "funded_by",       threshold: 0.55 },
    { name: "accused_of",      threshold: 0.55 },
    { name: "investigated_by", threshold: 0.55 },
    { name: "prosecuted_by",   threshold: 0.55 },
    { name: "convicted_of",    threshold: 0.55 },
    { name: "said",            threshold: 0.5  },
    { name: "believes",        threshold: 0.55 },
    { name: "endorses",        threshold: 0.55 },
    { name: "denies",          threshold: 0.55 },
    { name: "authored",        threshold: 0.55 },
    { name: "created",         threshold: 0.55 },
    { name: "published",       threshold: 0.55 },
    { name: "influenced_by",   threshold: 0.55 },
    { name: "part_of",         threshold: 0.5  },
    { name: "succeeded_by",    threshold: 0.6  },
    { name: "occurred_on",     threshold: 0.55 },
    { name: "caused",          threshold: 0.6  },
    { name: "resulted_in",     threshold: 0.6  },
  ],
  glirel: {
    modelId: "jackboyla/glirel-large-v0",
    minScore: 0.5,
    maxPairsPerSentence: 10,
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

export function loadRelationsConfig(
  repoRoot: string = process.cwd(),
): LoadedRelationsConfig {
  const labelsFile = readJson(resolve(repoRoot, "config/relation-labels.json"));
  const modelsFile = readJson(resolve(repoRoot, "config/models.json"));

  const predicates =
    labelsFile && Array.isArray(labelsFile.predicates)
      ? (labelsFile.predicates as PredicateConfig[])
      : DEFAULT.predicates;

  const glirel = {
    ...DEFAULT.glirel,
    ...((modelsFile?.glirel as Partial<LoadedRelationsConfig["glirel"]>) ?? {}),
  };

  return { predicates, glirel };
}
