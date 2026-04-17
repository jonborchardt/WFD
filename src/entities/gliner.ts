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

import { PersistentPythonDaemon } from "../shared/python-daemon.js";
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

let pipelineOverride: GlinerPipeline | null | undefined;
let glinerDaemon: PersistentPythonDaemon | null = null;

// Test hook — lets unit tests inject a fake pipeline so they do not
// spawn python or download weights. Pass null to short-circuit
// extraction and mirror the "no model available" path.
export function __setGlinerPipelineForTests(fake: GlinerPipeline | null): void {
  pipelineOverride = fake;
}

// Build a daemon-backed pipeline that keeps the model warm across
// multiple calls within a single process. The daemon loads once on
// first request; subsequent requests reuse the warm model.
function makeDaemonPipeline(config: GlinerConfig, repoRoot: string): GlinerPipeline {
  if (!glinerDaemon) {
    glinerDaemon = new PersistentPythonDaemon({
      scriptPath: config.scriptPath ?? "tools/gliner_sidecar.py",
      repoRoot,
      pythonBin: config.pythonBin,
    });
  }
  return {
    async predict(text, labels, opts) {
      const threshold = opts?.threshold ?? config.minScore;
      const result = await glinerDaemon!.request<{ mentions: GlinerRawMention[] }>({
        text,
        labels,
        threshold,
        model_id: config.modelId,
      });
      if (!result.ok || !result.data) {
        if (result.error) {
          console.warn(`[gliner] daemon unavailable: ${result.error}`);
        }
        return [];
      }
      return result.data.mentions ?? [];
    },
  };
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

  // Resolve pipeline: test override → daemon (warm, shared across
  // videos) → one-shot fallback. The daemon keeps the model loaded
  // across calls so videos 2..N skip the 30-second cold start.
  const pipe: GlinerPipeline =
    pipelineOverride !== undefined
      ? pipelineOverride!
      : makeDaemonPipeline(config, repoRoot);
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
