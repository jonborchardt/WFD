// Global vitest setup: neutralize neural pipelines so tests never
// attempt to download model weights or spawn a python subprocess.
// Individual tests that need entity or relation output inject fakes
// via the __set*PipelineForTests hooks.

import {
  __setGlinerPipelineForTests,
  __setCorefResultForTests,
} from "../../src/entities/index.ts";
import { __setGlirelPipelineForTests } from "../../src/relations/index.ts";

__setGlinerPipelineForTests(null);
__setCorefResultForTests(null);
__setGlirelPipelineForTests(null);
