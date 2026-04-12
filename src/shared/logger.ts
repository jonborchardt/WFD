// File-based logger. Writes JSONL lines to data/logs/captions.log so
// failures can be diagnosed after the fact. Also mirrors to stderr so you
// see events live during `npm run dev`.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

function defaultLogPath(): string {
  return join(process.cwd(), "data", "logs", "captions.log");
}

let currentPath = defaultLogPath();
// Default off during tests so vitest output stays clean. `npm run dev` flips
// this on in src/ui/main.ts.
let consoleMirror = !process.env.VITEST;

export function configureLogger(opts: { path?: string; console?: boolean }): void {
  if (opts.path) currentPath = opts.path;
  if (opts.console !== undefined) consoleMirror = opts.console;
}

export function log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  try {
    mkdirSync(dirname(currentPath), { recursive: true });
    appendFileSync(currentPath, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    // Logging must never throw into the request path.
    if (consoleMirror) {
      process.stderr.write(`log-write-failed: ${(e as Error).message}\n`);
    }
  }
  if (consoleMirror) {
    const prefix = level === "error" ? "✗" : level === "warn" ? "!" : "·";
    const suffix = Object.keys(data).length
      ? " " + JSON.stringify(data)
      : "";
    process.stderr.write(`${prefix} ${event}${suffix}\n`);
  }
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => log("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => log("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => log("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
};
