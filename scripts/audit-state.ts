// Read-only pipeline-state audit.
//
// For every catalog row, reports whether the transcript file exists,
// whether a per-video neural entities artifact exists, and how their
// mtimes compare. Output is a plain table plus a JSON summary at the
// end — check it in as a baseline before running any migration so the
// before/after diff is visible.

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog } from "../src/catalog/catalog.js";
import { entitiesPath } from "../src/entities/index.js";
import { transcriptPath } from "../src/ingest/transcript.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const dataDir = join(repoRoot, "data");

interface RowAudit {
  videoId: string;
  status: string;
  transcript: "present" | "missing";
  nlp: "present" | "missing" | "stale";
  fetchedAt?: string;
}

function mtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function main(): void {
  const catalog = new Catalog(Catalog.defaultPath());
  const rows = catalog.all();
  const audits: RowAudit[] = [];

  for (const row of rows) {
    const tPath =
      row.transcriptPath ??
      transcriptPath(row.videoId, join(dataDir, "transcripts"));
    const tExists = existsSync(tPath);
    const nPath = entitiesPath(row.videoId, dataDir);
    const nExists = existsSync(nPath);
    let nlpState: RowAudit["nlp"] = "missing";
    if (nExists) {
      nlpState = tExists && mtime(tPath) > mtime(nPath) ? "stale" : "present";
    }
    audits.push({
      videoId: row.videoId,
      status: row.status,
      transcript: tExists ? "present" : "missing",
      nlp: nlpState,
      fetchedAt: row.fetchedAt,
    });
  }

  const summary = {
    totalRows: audits.length,
    fetched: audits.filter((a) => a.status === "fetched").length,
    transcriptPresent: audits.filter((a) => a.transcript === "present").length,
    nlpPresent: audits.filter((a) => a.nlp === "present").length,
    nlpStale: audits.filter((a) => a.nlp === "stale").length,
    nlpMissingButFetched: audits.filter(
      (a) => a.status === "fetched" && a.nlp === "missing",
    ).length,
  };

  const suspicious = audits.filter(
    (a) =>
      a.nlp === "stale" ||
      (a.status === "fetched" && a.transcript === "missing") ||
      (a.status === "fetched" && a.nlp === "missing"),
  );

  console.log("=== catalog audit ===");
  console.log(JSON.stringify(summary, null, 2));
  if (suspicious.length > 0) {
    console.log(`\n=== ${suspicious.length} suspicious rows ===`);
    for (const s of suspicious) {
      console.log(
        `  ${s.videoId}  status=${s.status}  transcript=${s.transcript}  nlp=${s.nlp}`,
      );
    }
  }
}

main();
