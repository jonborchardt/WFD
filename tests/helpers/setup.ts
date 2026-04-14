// Global vitest setup: neutralize the neural NER pipeline so tests never
// attempt to download the BERT model. Individual tests that need NER-like
// behavior inject synthetic mentions via synthesizeNer().

import { __setNerPipelineForTests } from "../../src/nlp/ner.ts";

__setNerPipelineForTests(null);
