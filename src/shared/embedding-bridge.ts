// Node-side wrapper for tools/embeddings_sidecar.py.
//
// Embeds a batch of text
// strings through the sentence-transformers sidecar. Caches results to
// data/claims/embeddings.json keyed by a SHA-1 hash of the text so
// re-runs over unchanged claims are free.
//
// Graceful degradation — same contract as every other Python sidecar
// in this repo. If Python or sentence-transformers is missing, returns
// `{ ok: false, error }` and the caller falls back to Jaccard.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runPythonBridge } from "./python-bridge.js";

export interface EmbeddingSidecarPayload {
  texts: string[];
  model_id?: string;
  normalize?: boolean;
  batch_size?: number;
}

export interface EmbeddingSidecarResult {
  ok: boolean;
  model_id?: string;
  dimensions?: number;
  embeddings?: number[][];
  error?: string;
}

export interface EmbedBatchOptions {
  modelId?: string;
  pythonBin?: string;
  repoRoot?: string;
  timeoutMs?: number;
  batchSize?: number;
  scriptPath?: string;
}

const DEFAULT_MODEL_ID = "all-MiniLM-L6-v2";
const DEFAULT_SCRIPT = "tools/embeddings_sidecar.py";
const DEFAULT_TIMEOUT_MS = 900_000; // 15 min — corpus-scale single-batch run

// One-shot embed. Pass a batch of texts, get back a parallel array of
// vectors (or undefined entries if the sidecar failed). Caller does
// its own caching — see EmbeddingCache below for the on-disk layout.
export async function embedTexts(
  texts: string[],
  opts: EmbedBatchOptions = {},
): Promise<EmbeddingSidecarResult> {
  if (texts.length === 0) {
    return { ok: true, model_id: opts.modelId ?? DEFAULT_MODEL_ID, dimensions: 0, embeddings: [] };
  }
  const payload: EmbeddingSidecarPayload = {
    texts,
    model_id: opts.modelId ?? DEFAULT_MODEL_ID,
    normalize: true,
    batch_size: opts.batchSize ?? 64,
  };
  const result = await runPythonBridge<EmbeddingSidecarResult>(payload, {
    scriptPath: opts.scriptPath ?? DEFAULT_SCRIPT,
    repoRoot: opts.repoRoot,
    pythonBin: opts.pythonBin,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const data = result.data!;
  return {
    ok: true,
    model_id: data.model_id,
    dimensions: data.dimensions,
    embeddings: data.embeddings,
  };
}

// ---- Cache -----------------------------------------------------------
//
// data/claims/embeddings.json layout:
//   {
//     "schemaVersion": 1,
//     "modelId": "all-MiniLM-L6-v2",
//     "dimensions": 384,
//     "entries": {
//       "<textHash>": [0.0123, -0.456, ...]   // `dimensions` floats
//     }
//   }
//
// Key is a hash of (modelId + text) so a model change invalidates
// without deleting the file. Values are plain number[]; the detector
// converts to Float32Array at read time for math.

export interface EmbeddingCacheFile {
  schemaVersion: 1;
  modelId: string;
  dimensions: number;
  entries: Record<string, number[]>;
}

const CACHE_SCHEMA_VERSION = 1 as const;

export function hashTextKey(modelId: string, text: string): string {
  return createHash("sha1").update(`${modelId}\u0000${text}`).digest("hex");
}

export function readEmbeddingCache(path: string): EmbeddingCacheFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as EmbeddingCacheFile;
    if (
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      typeof parsed.modelId !== "string" ||
      typeof parsed.dimensions !== "number" ||
      typeof parsed.entries !== "object"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeEmbeddingCache(
  path: string,
  modelId: string,
  dimensions: number,
  entries: Record<string, number[]>,
): void {
  const file: EmbeddingCacheFile = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    modelId,
    dimensions,
    entries,
  };
  const dir = dirname(resolve(path));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(file), "utf8");
}

// Fill in any missing (text, vector) entries by calling the sidecar
// only on the uncached texts. Returns the merged cache (existing +
// new) plus a report. Callers pass in the full list of texts they
// need and get back `(hash -> vector)` for all of them.
export async function embedWithCache(
  cachePath: string,
  texts: Array<{ id: string; text: string }>,
  opts: EmbedBatchOptions = {},
): Promise<{
  ok: boolean;
  error?: string;
  modelId: string;
  dimensions: number;
  byId: Map<string, number[]>;
  newlyEmbedded: number;
  cacheHits: number;
}> {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const existing = readEmbeddingCache(cachePath);
  const entries: Record<string, number[]> =
    existing && existing.modelId === modelId ? { ...existing.entries } : {};
  let dimensions = existing?.modelId === modelId ? existing.dimensions : 0;

  const byId = new Map<string, number[]>();
  const need: Array<{ id: string; text: string; hash: string }> = [];
  let cacheHits = 0;
  for (const { id, text } of texts) {
    const hash = hashTextKey(modelId, text);
    const existingVec = entries[hash];
    if (existingVec && existingVec.length > 0) {
      byId.set(id, existingVec);
      cacheHits++;
    } else {
      need.push({ id, text, hash });
    }
  }

  if (need.length === 0) {
    return { ok: true, modelId, dimensions, byId, newlyEmbedded: 0, cacheHits };
  }

  const result = await embedTexts(
    need.map((n) => n.text),
    opts,
  );
  if (!result.ok || !result.embeddings) {
    return {
      ok: false,
      error: result.error ?? "embedTexts returned no data",
      modelId,
      dimensions,
      byId,
      newlyEmbedded: 0,
      cacheHits,
    };
  }
  dimensions = result.dimensions ?? dimensions;
  for (let i = 0; i < need.length; i++) {
    const vec = result.embeddings[i];
    if (!vec) continue;
    entries[need[i].hash] = vec;
    byId.set(need[i].id, vec);
  }
  writeEmbeddingCache(cachePath, modelId, dimensions, entries);
  return {
    ok: true,
    modelId,
    dimensions,
    byId,
    newlyEmbedded: need.length,
    cacheHits,
  };
}
