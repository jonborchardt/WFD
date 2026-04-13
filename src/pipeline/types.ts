// Pipeline runner types.
//
// A stage is a declarative unit of work against either a single catalog row
// (per-video) or the corpus graph as a whole (graph-level). The runner walks
// the stage list, decides which are stale, and runs them in dependency order.
//
// "Stale" is intentionally simple: a stage is stale if it has never run, if
// its recorded version is below the current implementation version, or if any
// of its dependencies recorded a timestamp more recent than its own. Stage
// version bumps are how you force a rerun after changing an extractor.

import { Catalog, CatalogRow, StageName, GraphStageName } from "../catalog/catalog.js";
import { GraphStore } from "../graph/store.js";

export interface PipelineContext {
  catalog: Catalog;
  dataDir: string;
  // Lazy graph store accessor; stages that don't touch the graph should not
  // force it to be constructed (keeps `pipeline --stage fetched` cheap).
  getStore(): GraphStore;
}

export type StageOutcome =
  | { kind: "ok"; notes?: string }
  // `awaiting` leaves the stage record untouched — for stages like `ai` that
  // hand off to an external process (Claude Code) and only mark themselves
  // done on a later run when the response file has landed.
  | { kind: "awaiting"; notes: string }
  | { kind: "skip"; reason: string };

export interface VideoStage {
  name: StageName;
  version: number;
  dependsOn: StageName[];
  run(row: CatalogRow, ctx: PipelineContext): Promise<StageOutcome>;
}

export interface GraphStage {
  name: GraphStageName;
  version: number;
  run(ctx: PipelineContext): Promise<StageOutcome>;
}

export interface RunResult {
  videoStagesRan: Array<{ videoId: string; stage: StageName; outcome: StageOutcome }>;
  graphStagesRan: Array<{ stage: GraphStageName; outcome: StageOutcome }>;
}
