// Stage-shaped entry point for the new entities extractor.
//
// Deliberately NOT registered in DEFAULT_VIDEO_STAGES yet — Commit 1 is
// scaffolding only and must not change the running pipeline. A CLI
// subcommand (`captions entities --video <id>`) drives it during the
// parallel-output phase while we eval it against the existing nlp stage.
//
// Signature intentionally matches VideoStage["run"] so promoting this to
// a real pipeline stage in a later commit is a one-line import change in
// src/pipeline/stages.ts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Transcript } from "./types.js";
import { loadConfig } from "./config.js";
import { extractEntities } from "./extract.js";
import { writePersistedEntities } from "./persist.js";

export interface EntitiesStageRow {
  videoId: string;
  transcriptPath?: string;
}

export interface EntitiesStageCtx {
  dataDir: string;
  repoRoot?: string;
}

export interface EntitiesStageOutcome {
  kind: "ok" | "skip";
  reason?: string;
  notes?: string;
  outputPath?: string;
  mentionsCount?: number;
}

function loadTranscript(row: EntitiesStageRow, dataDir: string): Transcript | null {
  const p = row.transcriptPath ?? join(dataDir, "transcripts", `${row.videoId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Transcript;
  } catch {
    return null;
  }
}

export async function runEntitiesStage(
  row: EntitiesStageRow,
  ctx: EntitiesStageCtx,
): Promise<EntitiesStageOutcome> {
  const transcript = loadTranscript(row, ctx.dataDir);
  if (!transcript) return { kind: "skip", reason: "transcript file missing" };

  const config = loadConfig(ctx.repoRoot);
  const payload = await extractEntities(transcript, {
    config,
    repoRoot: ctx.repoRoot,
  });
  const outputPath = writePersistedEntities(row.videoId, payload, ctx.dataDir);

  return {
    kind: "ok",
    notes: `${payload.mentions.length} mentions (coref=${payload.corefApplied})`,
    outputPath,
    mentionsCount: payload.mentions.length,
  };
}
