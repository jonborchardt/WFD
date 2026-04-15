// Stage-shaped entry point for the relations extractor.
//
// Like src/entities/stage.ts, NOT registered in DEFAULT_VIDEO_STAGES by
// default. The stage is wired into the pipeline behind the
// CAPTIONS_NEURAL_STAGES env flag (see src/pipeline/stages.ts) so
// operators can opt in during eval without touching code.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readPersistedEntities, type Transcript } from "../entities/index.js";
import { loadRelationsConfig } from "./config.js";
import { extractRelations } from "./extract.js";
import { writePersistedRelations } from "./persist.js";

export interface RelationsStageRow {
  videoId: string;
  transcriptPath?: string;
}

export interface RelationsStageCtx {
  dataDir: string;
  repoRoot?: string;
}

export interface RelationsStageOutcome {
  kind: "ok" | "skip";
  reason?: string;
  notes?: string;
  outputPath?: string;
  edgeCount?: number;
}

function loadTranscript(row: RelationsStageRow, dataDir: string): Transcript | null {
  const p = row.transcriptPath ?? join(dataDir, "transcripts", `${row.videoId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Transcript;
  } catch {
    return null;
  }
}

export async function runRelationsStage(
  row: RelationsStageRow,
  ctx: RelationsStageCtx,
): Promise<RelationsStageOutcome> {
  const transcript = loadTranscript(row, ctx.dataDir);
  if (!transcript) return { kind: "skip", reason: "transcript file missing" };

  const entities = readPersistedEntities(row.videoId, ctx.dataDir);
  if (!entities) {
    return { kind: "skip", reason: "entities stage output missing" };
  }

  const config = loadRelationsConfig(ctx.repoRoot);
  const payload = await extractRelations(transcript, entities, { config });
  const outputPath = writePersistedRelations(row.videoId, payload, ctx.dataDir);

  return {
    kind: "ok",
    notes: `${payload.edges.length} edges`,
    outputPath,
    edgeCount: payload.edges.length,
  };
}
