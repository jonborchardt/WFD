// Global vitest setup: neutralize neural pipelines so tests never attempt
// to download model weights or spawn a python subprocess. Individual tests
// that need NER-like behavior inject synthetic mentions via
// synthesizeNer() or the gliner test hook.

import { __setNerPipelineForTests } from "../../src/nlp/ner.ts";
import {
  __setGlinerPipelineForTests,
  __setCorefResultForTests,
} from "../../src/entities/index.ts";
import { __setGlirelPipelineForTests } from "../../src/relations/index.ts";

__setNerPipelineForTests(null);
__setGlinerPipelineForTests(null);
__setCorefResultForTests(null);
__setGlirelPipelineForTests(null);
