// GLiNER wrapper — zero-shot neural entity extraction.
//
// Backend: a Python sidecar at tools/gliner_sidecar.py, spawned once
// per extract() call. The sidecar loads the official `gliner` PyPI
// package and returns mentions with char offsets anchored to the input
// text. Node stays the orchestrator; Python does only the inference.
//
// Graceful degradation: if Python isn't available, if gliner isn't
// installed, or if the sidecar errors, we log a single warning and
// return []. The pipeline still runs.
//
// Tests inject a fake pipeline via __setGlinerPipelineForTests() so
// they never spawn python or download model weights.

import {
  runPythonBridge,
  type PythonBridgeOptions,
} from "../shared/python-bridge.js";
import { EntityLabel, GlinerRawMention } from "./types.js";

export interface GlinerPipeline {
  predict(
    text: string,
    labels: string[],
    opts?: { threshold?: number },
  ): Promise<GlinerRawMention[]>;
}

export interface GlinerConfig {
  modelId: string;
  minScore: number;
  maxChunkChars: number;
  // Python subprocess knobs. Overridable from config/models.json at load
  // time so tests can point at a fake script.
  pythonBin?: string;
  scriptPath?: string;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: GlinerConfig = {
  modelId: "urchade/gliner_large-v2.1",
  minScore: 0.5,
  maxChunkChars: 1200,
  pythonBin: "python",
  scriptPath: "tools/gliner_sidecar.py",
  timeoutMs: 600_000,
};

// Default implementation: shell out to the Python sidecar. Keeps the
// GlinerPipeline abstraction so tests can swap this wholesale.
function makePythonPipeline(config: GlinerConfig, repoRoot: string): GlinerPipeline {
  return {
    async predict(text, labels, opts) {
      const threshold = opts?.threshold ?? config.minScore;
      const bridgeOpts: PythonBridgeOptions = {
        scriptPath: config.scriptPath ?? "tools/gliner_sidecar.py",
        repoRoot,
        pythonBin: config.pythonBin,
        timeoutMs: config.timeoutMs,
      };
      const debug = process.env.CAPTIONS_PY_DEBUG === "1";
      const result = await runPythonBridge<{ mentions: GlinerRawMention[] }>(
        {
          text,
          labels,
          threshold,
          model_id: config.modelId,
          debug,
        },
        bridgeOpts,
      );
      if (!result.ok || !result.data) {
        if (result.error) {
          console.warn(`[gliner] sidecar unavailable: ${result.error}`);
        }
        return [];
      }
      return result.data.mentions ?? [];
    },
  };
}

let pipelineOverride: GlinerPipeline | null | undefined;

// Test hook — lets unit tests inject a fake pipeline so they do not
// spawn python or download weights. Pass null to short-circuit
// extraction and mirror the "no model available" path.
export function __setGlinerPipelineForTests(fake: GlinerPipeline | null): void {
  pipelineOverride = fake;
}

export interface RunGlinerOptions {
  labels: EntityLabel[];
  config?: Partial<GlinerConfig>;
  repoRoot?: string;
}

// Run GLiNER over the full flattened transcript text. Returns raw
// mentions with char offsets in the full-text coordinate system.
// Returns [] if the sidecar can't run or returns nothing.
//
// The Python sidecar handles long-document windowing internally, so we
// send the whole text in one call rather than pre-chunking on the Node
// side. chunkText() remains available for callers that need to
// parallelize or for tests.
export async function runGliner(
  text: string,
  opts: RunGlinerOptions,
): Promise<GlinerRawMention[]> {
  if (!text || text.length === 0) return [];
  const config: GlinerConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  const repoRoot = opts.repoRoot ?? process.cwd();

  // Resolve pipeline: test override wins, otherwise build the Python-
  // backed default on demand. We build a fresh pipeline per run rather
  // than caching one because config (model id, script path) can change
  // between calls and there is no in-process state to preserve — the
  // subprocess owns all the weight loading.
  const pipe: GlinerPipeline =
    pipelineOverride !== undefined
      ? pipelineOverride!
      : makePythonPipeline(config, repoRoot);
  if (!pipe) return [];

  let raw: GlinerRawMention[] = [];
  try {
    raw = await pipe.predict(text, opts.labels as string[], {
      threshold: config.minScore,
    });
  } catch (err) {
    console.warn("[gliner] predict failed:", (err as Error).message);
    return [];
  }
  const filtered = raw.filter((r) => r.score >= config.minScore);
  return dedupeOverlaps(filtered);
}

function dedupeOverlaps(mentions: GlinerRawMention[]): GlinerRawMention[] {
  const byKey = new Map<string, GlinerRawMention>();
  for (const m of mentions) {
    const key = `${m.start}:${m.end}:${m.label}`;
    const existing = byKey.get(key);
    if (!existing || m.score > existing.score) byKey.set(key, m);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start);
}
