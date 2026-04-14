// Background ingester.
//
// Walks pending catalog rows and fetches each transcript through the
// rate-limited client. Exposes a progress snapshot that the UI polls, so
// the user can watch the queue drain without blocking the request path.

import { statSync } from "node:fs";
import { Catalog } from "../catalog/catalog.js";
import { recordFailure, recordSuccess } from "../catalog/gaps.js";
import { fetchAndStore, TranscriptFetchError } from "./transcript.js";
import { logger } from "../shared/logger.js";

export interface IngestProgress {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current?: string;
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface IngesterOptions {
  catalog: Catalog;
  dataDir?: string;
  // Exposed for tests; defaults to the real fetcher.
  fetchTranscript?: typeof fetchAndStore;
}

export class Ingester {
  private progress: IngestProgress = {
    running: false,
    total: 0,
    done: 0,
    failed: 0,
  };
  private loopPromise: Promise<void> | null = null;

  constructor(private opts: IngesterOptions) {}

  snapshot(): IngestProgress {
    return { ...this.progress };
  }

  // Kick off a run if one isn't already in flight. Idempotent.
  start(): Promise<void> {
    if (this.loopPromise) return this.loopPromise;
    this.loopPromise = this.run().finally(() => {
      this.loopPromise = null;
    });
    return this.loopPromise;
  }

  private async run(): Promise<void> {
    const pending = this.opts.catalog
      .all()
      .filter((r) => r.status === "pending" || r.status === "failed-retryable");
    logger.info("ingest.run.start", { total: pending.length });
    this.progress = {
      running: true,
      total: pending.length,
      done: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
    };
    const fetcher = this.opts.fetchTranscript ?? fetchAndStore;
    for (const row of pending) {
      this.progress = { ...this.progress, current: row.videoId };
      logger.info("ingest.row.start", {
        videoId: row.videoId,
        attempts: row.attempts,
      });
      try {
        const stored = await fetcher(row.videoId, { dataDir: this.opts.dataDir });
        // Three cases:
        //   - real fetch (cached=false): record with now().
        //   - cached + row has no fetched stage record: backfill using the
        //     transcript file's mtime so downstream cascading still works.
        //   - cached + row already recorded: do nothing (idempotent).
        if (!stored.cached) {
          recordSuccess(
            this.opts.catalog,
            row.videoId,
            stored.path,
            stored.meta,
          );
        } else if (!row.stages?.fetched) {
          const mtime = statSync(stored.path).mtimeMs;
          recordSuccess(
            this.opts.catalog,
            row.videoId,
            stored.path,
            stored.meta,
            new Date(mtime).toISOString(),
          );
        }
        logger.info("ingest.row.success", {
          videoId: row.videoId,
          path: stored.path,
          cached: stored.cached,
          title: stored.meta?.title,
          uploadDate: stored.meta?.uploadDate,
        });
        this.progress = { ...this.progress, done: this.progress.done + 1 };
      } catch (e) {
        const err = e as TranscriptFetchError | Error;
        const failure =
          err instanceof TranscriptFetchError ? err.failure : undefined;
        const errorReason = failure?.kind;
        const kind: "retryable" | "needs-user" =
          errorReason === "no-captions" ||
          errorReason === "login-required" ||
          errorReason === "removed"
            ? "needs-user"
            : "retryable";
        const message = failure ? failure.kind : err.message;
        const stack = err instanceof Error ? err.stack : undefined;
        logger.error("ingest.row.failure", {
          videoId: row.videoId,
          kind,
          message,
          stack,
          failure,
        });
        recordFailure(
          this.opts.catalog,
          row.videoId,
          kind,
          message,
          errorReason,
        );
        this.progress = {
          ...this.progress,
          failed: this.progress.failed + 1,
          lastError: `${row.videoId}: ${message}`,
        };
      }
    }
    logger.info("ingest.run.finish", {
      done: this.progress.done,
      failed: this.progress.failed,
    });
    this.progress = {
      ...this.progress,
      running: false,
      current: undefined,
      finishedAt: new Date().toISOString(),
    };
  }
}
