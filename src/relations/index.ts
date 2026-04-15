// Public surface of the relations module. Mirrors src/entities/index.ts.

export type {
  PredicateName,
  PredicateConfig,
  RelationEdge,
  PersistedRelations,
  GlirelRawScore,
  GlirelSentenceInput,
} from "./types.js";

export {
  loadRelationsConfig,
  type LoadedRelationsConfig,
} from "./config.js";
export {
  scoreSentences,
  __setGlirelPipelineForTests,
  type GlirelPipeline,
  type GlirelConfig,
} from "./glirel.js";
export { extractRelations, type ExtractRelationsOptions } from "./extract.js";
export {
  writePersistedRelations,
  readPersistedRelations,
  relationsPath,
  relationsDir,
} from "./persist.js";
export {
  runRelationsStage,
  type RelationsStageRow,
  type RelationsStageCtx,
  type RelationsStageOutcome,
} from "./stage.js";
