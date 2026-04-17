// Relations extractor: walks each sentence, enumerates candidate entity
// pairs within the sentence, asks GLiREL to score each against the
// predicate list, filters by per-predicate threshold, and emits grounded
// RelationEdge records.
//
// Evidence invariant: both endpoints MUST resolve to mention ids from
// the input PersistedEntities payload, and the evidence span is the
// enclosing sentence. Anything that can't ground is dropped.

import {
  flatten,
  segmentSentences,
  type EntityMention,
  type EntitySpan,
  type PersistedEntities,
  type Transcript,
  type SentenceSpan,
} from "../entities/index.js";
import { scoreSentences } from "./glirel.js";
import { LoadedRelationsConfig } from "./config.js";
import { PersistedRelations, RelationEdge } from "./types.js";

export interface ExtractRelationsOptions {
  config: LoadedRelationsConfig;
}

// Target character length for a "relation window". YouTube auto-gen
// transcripts are cue-fragmented — each cue is 5-10 tokens, which is
// far too little context for zero-shot relation extraction to work
// reliably. We merge consecutive cues up to this budget so each window
// GLiREL sees has at least ~30-60 tokens of surrounding context.
// Tuned empirically on the first test transcript; worth revisiting
// once we eval on more material.
const RELATION_WINDOW_CHARS = 500;

// Merge adjacent segments returned by segmentSentences() into windows
// that respect the character budget. Each window preserves real start
// and end offsets into the flattened text, so entity-mention spans can
// be tested for containment with the same logic the old per-sentence
// code used.
function buildRelationWindows(
  segments: SentenceSpan[],
  targetChars: number,
): SentenceSpan[] {
  if (segments.length === 0) return [];
  const out: SentenceSpan[] = [];
  let curStart = segments[0].start;
  let curEnd = segments[0].end;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    const nextLen = s.end - curStart;
    if (nextLen > targetChars && curEnd > curStart) {
      out.push({ start: curStart, end: curEnd });
      curStart = s.start;
      curEnd = s.end;
    } else {
      curEnd = s.end;
    }
  }
  if (curEnd > curStart) {
    out.push({ start: curStart, end: curEnd });
  }
  return out;
}

// Closest-pair-first proximity ordering: compute midpoint distance
// between each candidate pair and sort ascending. Used to cap pairs per
// sentence when a sentence is long and entity-dense.
function orderedPairs(
  mentions: EntityMention[],
  cap: number,
): Array<[EntityMention, EntityMention]> {
  const pairs: Array<{ a: EntityMention; b: EntityMention; d: number }> = [];
  for (let i = 0; i < mentions.length; i++) {
    for (let j = i + 1; j < mentions.length; j++) {
      const a = mentions[i];
      const b = mentions[j];
      if (a.id === b.id) continue;
      const midA = (a.span.charStart + a.span.charEnd) / 2;
      const midB = (b.span.charStart + b.span.charEnd) / 2;
      pairs.push({ a, b, d: Math.abs(midA - midB) });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  return pairs.slice(0, cap).map((p) => [p.a, p.b]);
}

function sentenceSpan(
  transcript: Transcript,
  start: number,
  end: number,
  cueStarts: number[],
): EntitySpan {
  // Map the sentence's char range into cue-time coordinates using the
  // same binary-search logic as entities/flatten.makeSpan, inlined here
  // so we don't re-export an internal helper.
  let startCue = 0;
  for (let i = cueStarts.length - 1; i >= 0; i--) {
    if (cueStarts[i] <= start) {
      startCue = i;
      break;
    }
  }
  let endCue = startCue;
  for (let i = cueStarts.length - 1; i >= 0; i--) {
    if (cueStarts[i] <= Math.max(start, end - 1)) {
      endCue = i;
      break;
    }
  }
  const s = transcript.cues[startCue];
  const e = transcript.cues[endCue];
  return {
    transcriptId: transcript.videoId,
    charStart: start,
    charEnd: end,
    timeStart: s.start,
    timeEnd: e.start + e.duration,
  };
}

export async function extractRelations(
  transcript: Transcript,
  entities: PersistedEntities,
  opts: ExtractRelationsOptions,
): Promise<PersistedRelations> {
  const { config } = opts;
  const flat = flatten(transcript);
  const rawSegments = segmentSentences(flat.text);
  // Merge short cue-level segments into relation-sized windows so
  // GLiREL sees enough context to reason about cross-entity relations.
  const sentences = buildRelationWindows(rawSegments, RELATION_WINDOW_CHARS);
  const mentions = entities.mentions;
  const predicateNames = config.predicates.map((p) => p.name);
  const thresholdByPredicate = new Map(
    config.predicates.map((p) => [p.name, p.threshold]),
  );

  // First pass: collect one input per eligible sentence so we can batch
  // the whole transcript into a single Python spawn. Record the sentence
  // span, the unique-entities mapping, and the evidence span alongside
  // the input so we can assemble edges from the parallel results array
  // without re-doing the bookkeeping.
  interface Eligible {
    sentenceStart: number;
    sentenceEnd: number;
    uniqueEntities: EntityMention[];
    input: {
      text: string;
      entities: Array<{ start: number; end: number; label: string; surface: string }>;
      predicates: string[];
    };
  }
  const eligible: Eligible[] = [];

  for (const sent of sentences) {
    const inSent = mentions.filter(
      (m) => m.span.charStart >= sent.start && m.span.charEnd <= sent.end,
    );
    if (inSent.length < 2) continue;
    const pairs = orderedPairs(inSent, config.glirel.maxPairsPerSentence);
    if (pairs.length === 0) continue;

    const sentenceText = flat.text.slice(sent.start, sent.end);
    const uniqueEntities: EntityMention[] = [];
    const indexByMentionId = new Map<string, number>();
    for (const [a, b] of pairs) {
      for (const m of [a, b]) {
        if (!indexByMentionId.has(m.id)) {
          indexByMentionId.set(m.id, uniqueEntities.length);
          uniqueEntities.push(m);
        }
      }
    }
    eligible.push({
      sentenceStart: sent.start,
      sentenceEnd: sent.end,
      uniqueEntities,
      input: {
        text: sentenceText,
        entities: uniqueEntities.map((m) => ({
          start: m.span.charStart - sent.start,
          end: m.span.charEnd - sent.start,
          label: m.label,
          surface: m.surface,
        })),
        predicates: predicateNames,
      },
    });
  }

  // Second pass: one batch call spawns Python once for the whole
  // transcript. The returned array is parallel to `eligible`.
  const batchResults = await scoreSentences(
    eligible.map((e) => e.input),
    { config: config.glirel },
  );

  // Third pass: fold scored triples into RelationEdge records with
  // enforced evidence + threshold invariants.
  const edges: RelationEdge[] = [];
  let edgeIdx = 0;
  for (let i = 0; i < eligible.length; i++) {
    const eRow = eligible[i];
    const raw = batchResults[i] ?? [];
    if (raw.length === 0) continue;
    const evidence = sentenceSpan(
      transcript,
      eRow.sentenceStart,
      eRow.sentenceEnd,
      flat.cueStarts,
    );
    for (const r of raw) {
      const subj = eRow.uniqueEntities[r.subjectIndex];
      const obj = eRow.uniqueEntities[r.objectIndex];
      if (!subj || !obj) continue;
      if (subj.id === obj.id) continue;
      // Canonical self-loops: same mention text appearing twice inside
      // a sentence (e.g. "Phobos … Phobos") will have distinct mention
      // ids but the same canonical form. Drop them — a relation from
      // an entity to itself is never meaningful in this graph.
      if (
        subj.canonical.trim().toLowerCase() ===
        obj.canonical.trim().toLowerCase()
      ) {
        continue;
      }
      const threshold = thresholdByPredicate.get(r.predicate) ?? 1;
      if (r.score < threshold) continue;
      edges.push({
        id: `r_${String(++edgeIdx).padStart(4, "0")}`,
        predicate: r.predicate,
        subjectMentionId: subj.id,
        objectMentionId: obj.id,
        score: r.score,
        evidence,
      });
    }
  }

  return {
    schemaVersion: 1,
    transcriptId: transcript.videoId,
    model: config.glirel.modelId,
    modelVersion: null,
    predicatesUsed: predicateNames,
    generatedAt: new Date().toISOString(),
    edges,
  };
}
