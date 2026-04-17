// Public surface of the new entities module.
//
// Importers should pull from this file rather than reaching into
// submodules so the module's shape stays refactor-friendly during the
// parallel-output phase.

export type {
  EntityLabel,
  EntityMention,
  EntitySpan,
  PersistedEntities,
  Transcript,
  TranscriptCue,
} from "./types.js";

export { loadConfig, type LoadedConfig } from "./config.js";
export { flatten, makeSpan, type Flattened } from "./flatten.js";
export { segmentSentences, type SentenceSpan } from "./sentences.js";
export {
  runGliner,
  __setGlinerPipelineForTests,
  type GlinerPipeline,
  type GlinerConfig,
} from "./gliner.js";
export { runCoref, __setCorefResultForTests, type CorefResult } from "./coref.js";
export { canonicalize } from "./canonicalize.js";
export {
  writePersistedEntities,
  readPersistedEntities,
  entitiesPath,
  entitiesDir,
} from "./persist.js";
export { extractEntities, type ExtractOptions } from "./extract.js";
export {
  runEntitiesStage,
  type EntitiesStageRow,
  type EntitiesStageCtx,
  type EntitiesStageOutcome,
} from "./stage.js";
