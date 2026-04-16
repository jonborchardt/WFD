// Persistent Python subprocess bridge.
//
// Unlike python-bridge.ts (one spawn per call), this keeps a single
// Python process alive across many requests. The Python script enters
// a loop reading line-delimited JSON from stdin and writing one JSON
// response line to stdout per request. Model weights load once on
// startup, so the second-through-Nth calls skip the 30-second cold
// start entirely.
//
// Protocol:
//   1. Node spawns `python <script> --daemon`
//   2. Python loads the model, writes {"ready":true}\n to stdout
//   3. Node writes one JSON request per line to stdin
//   4. Python writes one JSON response per line to stdout
//   5. On stdin EOF, Python exits
//
// If the daemon crashes, the next request() call auto-restarts it.
// Graceful shutdown via shutdown() or process 'exit' hook.

import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface, Interface as ReadlineInterface } from "node:readline";

export interface DaemonOptions {
  scriptPath: string;       // relative to repoRoot
  repoRoot?: string;
  pythonBin?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  env?: Record<string, string>;
}

export interface DaemonResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const DEFAULTS = {
  pythonBin: "python",
  startupTimeoutMs: 300_000,  // 5 min — first-run model download
  requestTimeoutMs: 1_800_000, // 30 min — long transcripts
};

export class PersistentPythonDaemon {
  private child: ChildProcess | null = null;
  private rl: ReadlineInterface | null = null;
  private lineBuffer: string[] = [];
  private lineWaiter: ((line: string) => void) | null = null;
  private started = false;
  private opts: Required<Pick<DaemonOptions, "scriptPath" | "pythonBin" | "startupTimeoutMs" | "requestTimeoutMs">> & DaemonOptions;

  constructor(opts: DaemonOptions) {
    this.opts = {
      pythonBin: opts.pythonBin ?? DEFAULTS.pythonBin,
      startupTimeoutMs: opts.startupTimeoutMs ?? DEFAULTS.startupTimeoutMs,
      requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      ...opts,
    };
    // Auto-shutdown on process exit so the daemon doesn't zombie.
    process.on("exit", () => this.shutdown());
  }

  async request<T>(payload: unknown): Promise<DaemonResult<T>> {
    try {
      await this.ensureStarted();
    } catch (err) {
      return { ok: false, error: `daemon start failed: ${(err as Error).message}` };
    }
    if (!this.child || this.child.killed) {
      return { ok: false, error: "daemon not running" };
    }
    return this.sendAndReceive<T>(payload);
  }

  shutdown(): void {
    if (this.child) {
      try {
        this.child.stdin?.end();
      } catch { /* ignore */ }
      try {
        this.child.kill("SIGTERM");
      } catch { /* ignore */ }
      this.child = null;
      this.rl = null;
      this.started = false;
      this.lineBuffer = [];
      this.lineWaiter = null;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.started && this.child && !this.child.killed) return;
    this.shutdown(); // clean up any zombie

    const repoRoot = this.opts.repoRoot ?? process.cwd();
    const scriptAbs = resolve(repoRoot, this.opts.scriptPath);
    if (!existsSync(scriptAbs)) {
      throw new Error(`script not found: ${scriptAbs}`);
    }

    const quietEnv: Record<string, string> = {
      TRANSFORMERS_VERBOSITY: "error",
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
      HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      TQDM_DISABLE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONWARNINGS: "ignore",
    };

    this.child = spawn(this.opts.pythonBin, [scriptAbs, "--daemon"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...quietEnv, ...(this.opts.env ?? {}) },
    });

    // Unref the child and its streams so the daemon doesn't keep the
    // Node event loop alive after the pipeline finishes. When all other
    // work is done, Node exits naturally; the "exit" handler above then
    // calls shutdown() to SIGTERM the Python process.
    this.child.unref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      if (stream && "unref" in stream && typeof (stream as unknown as { unref: () => void }).unref === "function") {
        (stream as unknown as { unref: () => void }).unref();
      }
    }

    // Forward stderr to console in debug mode only.
    const debug = process.env.CAPTIONS_PY_DEBUG === "1";
    this.child.stderr?.on("data", (d: Buffer) => {
      if (debug) process.stderr.write(d);
    });

    // Set up line reader on stdout.
    this.rl = createInterface({ input: this.child.stdout! });
    this.rl.on("line", (line: string) => {
      if (this.lineWaiter) {
        const w = this.lineWaiter;
        this.lineWaiter = null;
        w(line);
      } else {
        this.lineBuffer.push(line);
      }
    });

    this.child.on("exit", () => {
      this.started = false;
    });

    // Wait for the {"ready": true} startup signal.
    const readyLine = await this.nextLine(this.opts.startupTimeoutMs);
    try {
      const parsed = JSON.parse(readyLine);
      if (!parsed.ready) {
        throw new Error(`unexpected startup line: ${readyLine.slice(0, 200)}`);
      }
    } catch (err) {
      this.shutdown();
      throw new Error(`daemon startup failed: ${(err as Error).message}`);
    }
    this.started = true;
  }

  private nextLine(timeoutMs: number): Promise<string> {
    // Check buffer first.
    if (this.lineBuffer.length > 0) {
      return Promise.resolve(this.lineBuffer.shift()!);
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lineWaiter = null;
        reject(new Error(`daemon response timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.lineWaiter = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  private async sendAndReceive<T>(payload: unknown): Promise<DaemonResult<T>> {
    const line = JSON.stringify(payload);
    try {
      this.child!.stdin!.write(line + "\n");
    } catch (err) {
      this.started = false;
      return { ok: false, error: `stdin write failed: ${(err as Error).message}` };
    }

    let responseLine: string;
    try {
      responseLine = await this.nextLine(this.opts.requestTimeoutMs);
    } catch (err) {
      this.shutdown();
      return { ok: false, error: (err as Error).message };
    }

    try {
      const parsed = JSON.parse(responseLine) as {
        ok: boolean;
        error?: string;
      } & Record<string, unknown>;
      if (!parsed.ok) {
        return { ok: false, error: parsed.error ?? "daemon reported !ok" };
      }
      return { ok: true, data: parsed as unknown as T };
    } catch (err) {
      return { ok: false, error: `bad daemon json: ${(err as Error).message}` };
    }
  }
}
