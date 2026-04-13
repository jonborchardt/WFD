// Pipeline runner.
//
// Walks the catalog and, for each row, runs whichever per-video stages are
// stale (never ran, version-bumped, or ran before a dependency). Then runs
// any graph-level stage whose last-run timestamp is older than the file-level
// `graph.dirtyAt` watermark. Stages failing or awaiting external input do not
// advance; the next run picks them up again.

import { Catalog, CatalogRow, StageName } from "../catalog/catalog.js";
import { GraphStore } from "../graph/store.js";
import {
  VideoStage,
  GraphStage,
  PipelineContext,
  RunResult,
} from "./types.js";
import {
  DEFAULT_VIDEO_STAGES,
  DEFAULT_GRAPH_STAGES,
} from "./stages.js";
import { logger } from "../shared/logger.js";
import { join } from "node:path";

export interface RunOptions {
  catalog: Catalog;
  dataDir: string;
  videoStages?: VideoStage[];
  graphStages?: GraphStage[];
  // Restrict to a single row / stage, typically from the CLI.
  onlyVideoId?: string;
  onlyStage?: StageName | "propagation" | "contradictions" | "novel";
  dryRun?: boolean;
  // Injected for tests so we don't load the real graph store.
  makeStore?: (path: string) => GraphStore;
}

// "Stale" means the stage's own record is out of date. It does NOT consider
// whether dependencies can run — that's depsSatisfied's job. Keeping the two
// concepts separate avoids the earlier bug where an unrun dep made a stage
// report "not stale", which is semantically wrong and only worked because the
// runner happened to check deps first.
function isVideoStageStale(row: CatalogRow, stage: VideoStage): boolean {
  const rec = row.stages?.[stage.name];
  if (!rec) return true;
  if (rec.version < stage.version) return true;
  // A dependency ran more recently than we did → we need to re-run.
  for (const dep of stage.dependsOn) {
    const depRec = row.stages?.[dep];
    if (depRec && depRec.at > rec.at) return true;
  }
  return false;
}

function depsSatisfied(
  row: CatalogRow,
  stage: VideoStage,
  stages: VideoStage[],
): boolean {
  for (const dep of stage.dependsOn) {
    const rec = row.stages?.[dep];
    if (!rec) return false;
    const depStage = stages.find((s) => s.name === dep);
    if (depStage && rec.version < depStage.version) return false;
  }
  return true;
}

function isGraphStageStale(
  catalog: Catalog,
  stage: GraphStage,
): boolean {
  const g = catalog.graphState();
  const rec = g.stages[stage.name];
  if (!rec) return true;
  if (rec.version < stage.version) return true;
  if (g.dirtyAt > rec.at) return true;
  return false;
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const videoStages = opts.videoStages ?? DEFAULT_VIDEO_STAGES;
  const graphStages = opts.graphStages ?? DEFAULT_GRAPH_STAGES;
  const result: RunResult = { videoStagesRan: [], graphStagesRan: [] };

  // Lazy graph store — stages that don't need it won't construct it.
  let store: GraphStore | null = null;
  const getStore = (): GraphStore => {
    if (!store) {
      const makeStore =
        opts.makeStore ?? ((p: string) => new GraphStore(p));
      store = makeStore(join(opts.dataDir, "graph", "graph.json"));
    }
    return store;
  };
  const ctx: PipelineContext = {
    catalog: opts.catalog,
    dataDir: opts.dataDir,
    getStore,
  };

  const rows = opts.onlyVideoId
    ? opts.catalog.all().filter((r) => r.videoId === opts.onlyVideoId)
    : opts.catalog.all();

  // Per-video pass. Snapshot ids up front; re-read each row before every
  // stage so writes from a prior stage in the same loop (or from another
  // process) are visible without mutating loop variables.
  const videoIds = rows.map((r) => r.videoId);
  for (const videoId of videoIds) {
    for (const stage of videoStages) {
      if (opts.onlyStage && opts.onlyStage !== stage.name) continue;
      const row = opts.catalog.get(videoId);
      if (!row) continue;
      if (!depsSatisfied(row, stage, videoStages)) continue;
      if (!isVideoStageStale(row, stage)) continue;
      if (opts.dryRun) {
        result.videoStagesRan.push({
          videoId,
          stage: stage.name,
          outcome: { kind: "skip", reason: "dry-run" },
        });
        continue;
      }
      logger.info("pipeline.video.start", { videoId, stage: stage.name });
      let outcome;
      try {
        outcome = await stage.run(row, ctx);
      } catch (e) {
        const err = e as Error;
        logger.error("pipeline.video.error", {
          videoId,
          stage: stage.name,
          message: err.message,
          stack: err.stack,
        });
        outcome = {
          kind: "skip" as const,
          reason: `error: ${err.message}`,
        };
      }
      if (outcome.kind === "ok") {
        opts.catalog.setStage(videoId, stage.name, {
          at: new Date().toISOString(),
          version: stage.version,
          notes: outcome.notes,
        });
      }
      result.videoStagesRan.push({ videoId, stage: stage.name, outcome });
    }
  }

  // Graph-level pass.
  for (const stage of graphStages) {
    if (opts.onlyStage && opts.onlyStage !== stage.name) continue;
    if (!isGraphStageStale(opts.catalog, stage)) continue;
    if (opts.dryRun) {
      result.graphStagesRan.push({
        stage: stage.name,
        outcome: { kind: "skip", reason: "dry-run" },
      });
      continue;
    }
    logger.info("pipeline.graph.start", { stage: stage.name });
    let outcome;
    try {
      outcome = await stage.run(ctx);
    } catch (e) {
      const err = e as Error;
      logger.error("pipeline.graph.error", {
        stage: stage.name,
        message: err.message,
        stack: err.stack,
      });
      outcome = {
        kind: "skip" as const,
        reason: `error: ${err.message}`,
      };
    }
    if (outcome.kind === "ok") {
      opts.catalog.setGraphStage(stage.name, {
        at: new Date().toISOString(),
        version: stage.version,
      });
    }
    result.graphStagesRan.push({ stage: stage.name, outcome });
  }

  return result;
}
