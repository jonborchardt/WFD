// Gap detection: which catalog rows are missing transcripts, and what to do.

import { existsSync } from "node:fs";
import { Catalog, CatalogRow, ErrorReason, VideoMeta } from "./catalog.js";

export type GapBucket = "retry" | "needs-user" | "ok";

export interface GapEntry {
  row: CatalogRow;
  bucket: GapBucket;
  reason: string;
}

export function classifyRow(row: CatalogRow): GapEntry {
  if (row.transcriptPath && existsSync(row.transcriptPath) && row.status === "fetched") {
    return { row, bucket: "ok", reason: "transcript present" };
  }
  if (row.status === "failed-needs-user") {
    return {
      row,
      bucket: "needs-user",
      reason: row.lastError ?? "no captions available; upload or pick another source",
    };
  }
  return {
    row,
    bucket: "retry",
    reason: row.lastError ?? "not yet fetched",
  };
}

export interface GapReport {
  retry: GapEntry[];
  needsUser: GapEntry[];
  ok: GapEntry[];
}

export function detectGaps(catalog: Catalog): GapReport {
  const report: GapReport = { retry: [], needsUser: [], ok: [] };
  for (const row of catalog.all()) {
    const g = classifyRow(row);
    if (g.bucket === "ok") report.ok.push(g);
    else if (g.bucket === "retry") report.retry.push(g);
    else report.needsUser.push(g);
  }
  return report;
}

export function formatGapReport(report: GapReport): string {
  const lines: string[] = [];
  lines.push(`ok: ${report.ok.length}`);
  lines.push(`retry: ${report.retry.length}`);
  for (const g of report.retry) {
    lines.push(`  - ${g.row.videoId} ${g.reason}`);
  }
  lines.push(`needs-user: ${report.needsUser.length}`);
  for (const g of report.needsUser) {
    lines.push(`  - ${g.row.videoId} ${g.reason}`);
  }
  return lines.join("\n");
}

// Record the outcome of a fetch attempt so that gap classification picks it up
// on the next run.
export function recordFailure(
  catalog: Catalog,
  videoId: string,
  kind: "retryable" | "needs-user",
  message: string,
  errorReason?: ErrorReason,
): void {
  const row = catalog.get(videoId);
  if (!row) throw new Error(`gaps: no row for ${videoId}`);
  catalog.update(videoId, {
    status: kind === "retryable" ? "failed-retryable" : "failed-needs-user",
    lastError: message,
    errorReason,
  });
}

// Record a successful transcript fetch. Always writes the `fetched` stage
// record because callers must only invoke this on real fetches (or deliberate
// backfills where they pass `at` explicitly). The gold-transcript fast path
// in the pipeline skips the call entirely on a cache hit.
export function recordSuccess(
  catalog: Catalog,
  videoId: string,
  transcriptPath: string,
  meta?: VideoMeta,
  at: string = new Date().toISOString(),
): void {
  const row = catalog.get(videoId);
  if (!row) throw new Error(`gaps: no row for ${videoId}`);
  catalog.update(videoId, {
    ...(meta ?? {}),
    status: "fetched",
    transcriptPath,
    lastError: undefined,
    errorReason: undefined,
  });
  catalog.setStage(videoId, "fetched", { at });
}
