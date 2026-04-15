// GLiREL wrapper — zero-shot neural relation classification.
//
// Backend: a Python sidecar at tools/glirel.py. All sentences for one
// transcript are batched into a single spawn so the GLiREL model loads
// exactly once per extract() call.
//
// Graceful degradation: if Python isn't available, if glirel isn't
// installed, or if the sidecar errors, we log a single warning and
// return empty score arrays. The pipeline still runs.

import {
  runPythonBridge,
  type PythonBridgeOptions,
} from "../shared/python-bridge.js";
import { GlirelRawScore, GlirelSentenceInput } from "./types.js";

export interface GlirelPipeline {
  // Batch interface: one call scores every sentence in a transcript.
  // Returns a parallel array of per-sentence score lists so callers can
  // walk sentences and scores in lock-step.
  scoreBatch(sentences: GlirelSentenceInput[]): Promise<GlirelRawScore[][]>;
}

export interface GlirelConfig {
  modelId: string;
  minScore: number;
  maxPairsPerSentence: number;
  pythonBin?: string;
  scriptPath?: string;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: GlirelConfig = {
  modelId: "jackboyla/glirel-large-v0",
  minScore: 0.5,
  maxPairsPerSentence: 10,
  pythonBin: "python",
  scriptPath: "tools/glirel_sidecar.py",
  timeoutMs: 600_000,
};

function makePythonPipeline(config: GlirelConfig, repoRoot: string): GlirelPipeline {
  return {
    async scoreBatch(sentences) {
      if (sentences.length === 0) return [];
      const bridgeOpts: PythonBridgeOptions = {
        scriptPath: config.scriptPath ?? "tools/glirel_sidecar.py",
        repoRoot,
        pythonBin: config.pythonBin,
        timeoutMs: config.timeoutMs,
      };
      const debug = process.env.CAPTIONS_PY_DEBUG === "1";
      const result = await runPythonBridge<{ results: GlirelRawScore[][] }>(
        {
          sentences,
          threshold: config.minScore,
          model_id: config.modelId,
          debug,
        },
        bridgeOpts,
      );
      if (!result.ok || !result.data) {
        if (result.error) {
          console.warn(`[glirel] sidecar unavailable: ${result.error}`);
        }
        return sentences.map(() => []);
      }
      const results = result.data.results ?? [];
      // Defensive: pad or truncate so the length matches the input.
      const out: GlirelRawScore[][] = [];
      for (let i = 0; i < sentences.length; i++) {
        out.push(Array.isArray(results[i]) ? results[i] : []);
      }
      return out;
    },
  };
}

let pipelineOverride: GlirelPipeline | null | undefined;

// Test hook — lets unit tests inject a fake pipeline.
export function __setGlirelPipelineForTests(fake: GlirelPipeline | null): void {
  pipelineOverride = fake;
}

export interface ScoreBatchOptions {
  config?: Partial<GlirelConfig>;
  repoRoot?: string;
}

export async function scoreSentences(
  sentences: GlirelSentenceInput[],
  opts: ScoreBatchOptions = {},
): Promise<GlirelRawScore[][]> {
  if (sentences.length === 0) return [];
  const config: GlirelConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  const repoRoot = opts.repoRoot ?? process.cwd();
  const pipe: GlirelPipeline =
    pipelineOverride !== undefined
      ? pipelineOverride!
      : makePythonPipeline(config, repoRoot);
  if (!pipe) return sentences.map(() => []);
  try {
    const scored = await pipe.scoreBatch(sentences);
    return scored.map((row) => row.filter((r) => r.score >= config.minScore));
  } catch (err) {
    console.warn("[glirel] batch scoring failed:", (err as Error).message);
    return sentences.map(() => []);
  }
}

export { DEFAULT_CONFIG as DEFAULT_GLIREL_CONFIG };
