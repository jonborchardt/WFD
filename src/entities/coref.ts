// Coref resolution via the Python sidecar at tools/coref.py.
//
// Uses the shared python-bridge helper so error reporting, timeout, and
// graceful-degradation behavior match gliner and glirel. On top of the
// bridge result we keep a length-sanity check: if fastcoref returns
// resolved text that is wildly different in length from the input, we
// refuse it so downstream char-offset-based code does not get fed junk.

import {
  runPythonBridge,
  type PythonBridgeOptions,
} from "../shared/python-bridge.js";

export interface CorefConfig {
  enabled: boolean;
  pythonBin: string;
  scriptPath: string; // relative to repo root
  timeoutMs: number;
}

export interface CorefResult {
  text: string;         // coref-resolved if successful, else original
  applied: boolean;     // did we actually run it
  error?: string;       // reason we fell back, if any
}

const DEFAULT_CONFIG: CorefConfig = {
  enabled: true,
  pythonBin: "python",
  scriptPath: "tools/coref.py",
  // First-run fastcoref model download from HuggingFace can take
  // minutes. Match the gliner/glirel budget.
  timeoutMs: 600_000,
};

// Test hook: lets unit tests force "unavailable" without spawning.
let forcedResultForTests: CorefResult | null | undefined;
export function __setCorefResultForTests(result: CorefResult | null): void {
  forcedResultForTests = result;
}

interface CorefSidecarPayload {
  resolved_text?: string;
}

export async function runCoref(
  text: string,
  config: Partial<CorefConfig> = {},
  repoRoot: string = process.cwd(),
): Promise<CorefResult> {
  if (forcedResultForTests !== undefined) {
    return forcedResultForTests ?? { text, applied: false, error: "forced-null" };
  }
  const cfg: CorefConfig = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) {
    return { text, applied: false, error: "disabled" };
  }
  if (!text || text.length === 0) {
    return { text, applied: false, error: "empty input" };
  }

  const bridgeOpts: PythonBridgeOptions = {
    scriptPath: cfg.scriptPath,
    repoRoot,
    pythonBin: cfg.pythonBin,
    timeoutMs: cfg.timeoutMs,
  };

  const result = await runPythonBridge<CorefSidecarPayload>(
    { text },
    bridgeOpts,
  );

  if (!result.ok || !result.data) {
    return { text, applied: false, error: result.error ?? "unknown bridge error" };
  }

  const resolved =
    typeof result.data.resolved_text === "string" ? result.data.resolved_text : text;

  // Length sanity check: coref shouldn't drastically shrink or grow the
  // text. If it does, something is wrong — don't pass junk to
  // downstream span-aligned code.
  if (Math.abs(resolved.length - text.length) > text.length * 0.5) {
    return { text, applied: false, error: "resolved text length diverged" };
  }

  return { text: resolved, applied: true };
}
