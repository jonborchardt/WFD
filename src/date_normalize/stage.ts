// Stage entry point for date-normalize. Reads data/entities/<id>.json,
// walks date_time mentions, and writes derived mentions to
// data/date-normalize/<id>.json. Does not mutate the entities file.

import { readPersistedEntities } from "../entities/persist.js";
import type { EntityMention } from "../entities/types.js";
import { deriveMentions } from "./derive.js";
import { writePersistedDerivedDates } from "./persist.js";
import type { PersistedDerivedDates } from "./types.js";

export interface DateNormalizeStageRow {
  videoId: string;
}

export interface DateNormalizeStageCtx {
  dataDir: string;
}

export interface DateNormalizeStageOutcome {
  kind: "ok" | "skip";
  reason?: string;
  notes?: string;
  outputPath?: string;
  mentionsCount?: number;
}

export async function runDateNormalizeStage(
  row: DateNormalizeStageRow,
  ctx: DateNormalizeStageCtx,
): Promise<DateNormalizeStageOutcome> {
  const persisted = readPersistedEntities(row.videoId, ctx.dataDir);
  if (!persisted) {
    return { kind: "skip", reason: "entities stage output missing" };
  }

  const derived: EntityMention[] = [];
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `d_${String(counter).padStart(4, "0")}`;
  };

  let parsedSources = 0;
  for (const m of persisted.mentions) {
    if (m.label !== "date_time") continue;
    const rows = deriveMentions(m, nextId);
    if (rows.length > 0) parsedSources += 1;
    for (const r of rows) derived.push(r);
  }

  const payload: PersistedDerivedDates = {
    schemaVersion: 1,
    transcriptId: row.videoId,
    generatedAt: new Date().toISOString(),
    sourceEntitiesGeneratedAt: persisted.generatedAt ?? null,
    mentions: derived,
  };

  const outputPath = writePersistedDerivedDates(row.videoId, payload, ctx.dataDir);
  return {
    kind: "ok",
    notes: `${derived.length} derived · ${parsedSources} source date_time parsed`,
    outputPath,
    mentionsCount: derived.length,
  };
}
