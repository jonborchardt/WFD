// Shared helper for spawning a Python preprocessing sidecar, piping one
// JSON object in on stdin, and reading one JSON object back from stdout.
//
// Used by every Python-backed stage in this repo (coref, gliner, glirel).
// Each script speaks the same protocol:
//
//   stdin:  a single JSON object, script-specific shape
//   stdout: { "ok": true,  ... }  on success
//           { "ok": false, "error": "..." } on failure
//
// Graceful degradation: if Python or the script is missing, if the
// subprocess errors, or if the JSON doesn't parse, we log a warning and
// return null. Every caller then falls back to "no results" without
// crashing the pipeline.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface PythonBridgeOptions {
  scriptPath: string;       // relative to repoRoot
  repoRoot?: string;
  pythonBin?: string;
  timeoutMs?: number;
  // If set, forwarded as additional env vars to the subprocess. Useful for
  // pinning HF_HOME / TRANSFORMERS_CACHE so model downloads land on a
  // specific drive without touching the parent process environment.
  env?: Record<string, string>;
}

export interface PythonBridgeResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const DEFAULTS = {
  pythonBin: "python",
  timeoutMs: 1_800_000, // 30 minutes — long transcripts with 300+ chunks need time on CPU
};

// Test hook: lets unit tests short-circuit every Python bridge call
// without spawning anything. Set to a function that synchronously
// produces a result and it will be used for all calls until cleared.
type ForcedFn = (<T>(scriptPath: string, payload: unknown) => PythonBridgeResult<T>) | null;
let forcedFn: ForcedFn = null;
export function __setPythonBridgeForTests(fn: ForcedFn): void {
  forcedFn = fn;
}

export async function runPythonBridge<T>(
  payload: unknown,
  opts: PythonBridgeOptions,
): Promise<PythonBridgeResult<T>> {
  if (forcedFn) {
    return forcedFn<T>(opts.scriptPath, payload);
  }
  const repoRoot = opts.repoRoot ?? process.cwd();
  const scriptAbs = resolve(repoRoot, opts.scriptPath);
  if (!existsSync(scriptAbs)) {
    return { ok: false, error: `script not found: ${scriptAbs}` };
  }
  const pythonBin = opts.pythonBin ?? DEFAULTS.pythonBin;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;

  return new Promise<PythonBridgeResult<T>>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: PythonBridgeResult<T>): void => {
      if (settled) return;
      settled = true;
      resolvePromise(r);
    };

    let child;
    try {
      // Silence tqdm progress bars, transformers banner noise, and
      // the huggingface_hub "unauthenticated requests" info print by
      // default — they flood stderr and make the real error/debug
      // lines hard to find. Callers can override via opts.env if they
      // need the raw bars back for a specific debug session.
      const quietEnv: Record<string, string> = {
        TRANSFORMERS_VERBOSITY: "error",
        HF_HUB_DISABLE_PROGRESS_BARS: "1",
        HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        TQDM_DISABLE: "1",
        PYTHONUNBUFFERED: "1",
        PYTHONWARNINGS: "ignore",
      };
      child = spawn(pythonBin, [scriptAbs], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...quietEnv, ...(opts.env ?? {}) },
      });
    } catch (err) {
      done({ ok: false, error: `spawn failed: ${(err as Error).message}` });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      done({ ok: false, error: `python bridge timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    const stderrPassthrough = process.env.CAPTIONS_PY_DEBUG === "1";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      stderr += s;
      if (stderrPassthrough) {
        process.stderr.write(s);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      console.warn(`[python-bridge] spawn error: ${err.message}`);
      done({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // The sidecar protocol says: on failure, write {ok:false,
        // error:"..."} to stdout and exit 1. Try to parse stdout first
        // so the real error message (e.g. "ModuleNotFoundError") is
        // surfaced — stderr is usually empty for intentional fails.
        let reason = stderr.slice(0, 400).trim();
        try {
          const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string };
          if (parsed && parsed.ok === false && typeof parsed.error === "string") {
            reason = parsed.error;
          }
        } catch {
          /* stdout wasn't JSON; fall through to stderr */
        }
        if (!reason) reason = `no output (stdout=${stdout.slice(0, 200)})`;
        // Keep the console noise to one line even when the error body
        // is a multi-line Python traceback. The full reason is still
        // returned to the caller in the error field.
        const firstLine = reason.split("\n")[0].slice(0, 300);
        console.warn(
          `[python-bridge] ${opts.scriptPath} exited ${code}: ${firstLine}`,
        );
        done({ ok: false, error: `exit ${code}: ${reason}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          ok: boolean;
          error?: string;
        } & Record<string, unknown>;
        if (!parsed.ok) {
          done({ ok: false, error: parsed.error ?? "sidecar reported !ok" });
          return;
        }
        done({ ok: true, data: parsed as unknown as T });
      } catch (err) {
        done({
          ok: false,
          error: `bad sidecar json: ${(err as Error).message}; head=${stdout.slice(0, 200)}`,
        });
      }
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      done({
        ok: false,
        error: `stdin write failed: ${(err as Error).message}`,
      });
    }
  });
}
