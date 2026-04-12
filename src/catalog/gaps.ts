// Gap detection: which catalog rows are missing transcripts, and what to do.

import { existsSync } from "node:fs";
import { Catalog, CatalogRow, VideoMeta } from "./catalog.js";

export type GapBucket = "retry" | "needs-user" | "ok";

export interface GapEntry {
  row: CatalogRow;
  bucket: GapBucket;
  reason: string;
}

export const MAX_RETRY_ATTEMPTS = 5;

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
  if (row.status === "failed-retryable" && row.attempts >= MAX_RETRY_ATTEMPTS) {
    return {
      row,
      bucket: "needs-user",
      reason: `retries exhausted (${row.attempts}); last error: ${row.lastError ?? "unknown"}`,
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
    lines.push(`  - ${g.row.videoId} (attempts=${g.row.attempts}) ${g.reason}`);
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
): void {
  const row = catalog.get(videoId);
  if (!row) throw new Error(`gaps: no row for ${videoId}`);
  catalog.update(videoId, {
    status: kind === "retryable" ? "failed-retryable" : "failed-needs-user",
    attempts: row.attempts + 1,
    lastError: message,
  });
}

export function recordSuccess(
  catalog: Catalog,
  videoId: string,
  transcriptPath: string,
  meta?: VideoMeta,
): void {
  const row = catalog.get(videoId);
  if (!row) throw new Error(`gaps: no row for ${videoId}`);
  catalog.update(videoId, {
    ...(meta ?? {}),
    status: "fetched",
    transcriptPath,
    fetchedAt: new Date().toISOString(),
    lastError: undefined,
  });
}
