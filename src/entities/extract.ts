// Orchestrator: flatten transcript → run coref (optional) → GLiNER →
// canonicalize → assemble a PersistedEntities record. Pure function; no
// disk I/O. The persist module is a separate step so tests can inspect
// the in-memory payload without touching the filesystem.

import { flatten } from "./flatten.js";
import { runGliner } from "./gliner.js";
import { runCoref } from "./coref.js";
import { canonicalize } from "./canonicalize.js";
import { LoadedConfig } from "./config.js";
import { PersistedEntities, Transcript } from "./types.js";

export interface ExtractOptions {
  config: LoadedConfig;
  repoRoot?: string;
}

export async function extractEntities(
  transcript: Transcript,
  opts: ExtractOptions,
): Promise<PersistedEntities> {
  const { config } = opts;
  const flat = flatten(transcript);

  // Coref runs over the flattened text. If it succeeds the resolved text
  // replaces the original for GLiNER extraction; otherwise we pass the
  // flattened text through unchanged and record corefApplied:false.
  //
  // IMPORTANT: span char offsets from GLiNER are anchored to whichever
  // text we actually feed the model. When coref rewrites the text, offsets
  // from GLiNER no longer line up with the *original* cue boundaries. To
  // keep the evidence invariant intact in Commit 1, we only use the
  // resolved text if its length matches the input closely enough that
  // char-level alignment is safe — the coref wrapper already enforces
  // that, and we document the remaining gap below.
  const coref = await runCoref(flat.text, config.coref, opts.repoRoot);
  const modelText = coref.applied ? coref.text : flat.text;

  const rawMentions = await runGliner(modelText, {
    labels: config.labels,
    config: config.gliner,
  });

  // If coref *was* applied and changed text length at all, the GLiNER
  // offsets may be slightly off. In practice fastcoref does token-level
  // substitutions that shift offsets. Commit 1 accepts this imperfection
  // only when coref is available; if precise alignment matters we can
  // either re-run GLiNER on the original text or ship a span-remapper in
  // a later commit. Flag it on the output so downstream code knows.
  const alignmentSafe = !coref.applied || modelText.length === flat.text.length;
  const rawForAlign = alignmentSafe ? rawMentions : [];

  const mentions = canonicalize(rawForAlign, config.labels, transcript, flat);

  return {
    schemaVersion: 1,
    transcriptId: transcript.videoId,
    model: config.gliner.modelId,
    modelVersion: null,
    labelsUsed: config.labels,
    corefApplied: coref.applied && alignmentSafe,
    generatedAt: new Date().toISOString(),
    mentions,
  };
}
