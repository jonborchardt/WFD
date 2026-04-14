// Entity extraction from transcripts.
//
// Two entity producers feed a single normalize() pass:
//
//   1. Regex + gazetteer  — times, dates, and gazetteer-backed orgs and
//                            locations. Pure JS, sync.
//   2. Neural NER (BERT)  — persons, organizations, locations, misc. Runs
//                            through @xenova/transformers. Case-insensitive in
//                            practice and necessary for the lowercase auto-
//                            generated transcripts that dominate this corpus.
//
// Because the neural pass is async and the rest of the extractor is sync,
// NER mentions are computed by the caller (typically the pipeline stage)
// and passed in as an option. Tests and the UI preview path can omit them
// and still get regex-only extraction — graceful degradation is intentional.
//
// Entity types emitted: person, misc, time, location, organization.

import { Entity, TranscriptSpan } from "../shared/types.js";
import { resolveCoreferences } from "./coref.js";
import type { NerMention } from "./ner.js";

export interface TranscriptCue {
  start: number;
  duration: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  language?: string;
  kind?: "auto" | "manual";
  cues: TranscriptCue[];
}

// Small built-in gazetteer. Real deployments would load this from
// data/gazetteer/*.json; keeping a tiny seed here so the pipeline runs and
// tests have something to bite on.
export const DEFAULT_GAZETTEER = {
  organization: [
    "United Nations",
    "World Health Organization",
    "FBI",
    "CIA",
    "NASA",
    "Google",
    "OpenAI",
    "Anthropic",
  ],
  location: [
    "Washington",
    "New York",
    "London",
    "Paris",
    "Moscow",
    "Beijing",
    "Tokyo",
    "Berlin",
  ],
};

export interface GazetteerMap {
  organization: string[];
  location: string[];
}

interface Mention {
  type: Entity["type"];
  surface: string;
  canonical: string;
  span: TranscriptSpan;
}

// Walk cues, concatenate into a single buffer tracking (cueIndex, charOffset)
// so spans can be reported as global char offsets within the transcript text.
export function flatten(transcript: Transcript): {
  text: string;
  cueStarts: number[]; // char offset of each cue in the flattened text
} {
  const parts: string[] = [];
  const cueStarts: number[] = [];
  let offset = 0;
  for (const cue of transcript.cues) {
    cueStarts.push(offset);
    parts.push(cue.text);
    offset += cue.text.length + 1; // +1 for newline separator
  }
  return { text: parts.join("\n"), cueStarts };
}

function cueIndexForOffset(cueStarts: number[], offset: number): number {
  // Largest i with cueStarts[i] <= offset.
  let lo = 0,
    hi = cueStarts.length - 1,
    best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cueStarts[mid] <= offset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function makeSpan(
  transcript: Transcript,
  cueStarts: number[],
  charStart: number,
  charEnd: number,
): TranscriptSpan {
  const startCue = cueIndexForOffset(cueStarts, charStart);
  const endCue = cueIndexForOffset(cueStarts, charEnd);
  const start = transcript.cues[startCue];
  const end = transcript.cues[endCue];
  return {
    transcriptId: transcript.videoId,
    charStart,
    charEnd,
    timeStart: start.start,
    timeEnd: end.start + end.duration,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gazetteerMentions(
  type: Entity["type"],
  list: string[],
  text: string,
  transcript: Transcript,
  cueStarts: number[],
): Mention[] {
  const out: Mention[] = [];
  for (const term of list) {
    const re = new RegExp(`\\b${escapeRe(term)}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({
        type,
        surface: m[0],
        canonical: term,
        span: makeSpan(transcript, cueStarts, m.index, m.index + m[0].length),
      });
    }
  }
  return out;
}

// Person/org/location detection used to live here as a capitalized-word
// regex. It was deleted when the neural NER pass landed — it only fired on
// properly-cased text, which is the opposite of what the YouTube
// auto-generated transcript corpus contains. The neural pass in
// src/nlp/ner.ts replaces it.

// Time/date mentions. Years, ISO dates, "January 5 2024", relative ("yesterday"
// is ignored — too noisy without context).
function timeMentions(
  text: string,
  transcript: Transcript,
  cueStarts: number[],
): Mention[] {
  const out: Mention[] = [];
  const patterns: RegExp[] = [
    /\b(?:19|20)\d{2}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({
        type: "time",
        surface: m[0],
        canonical: m[0],
        span: makeSpan(transcript, cueStarts, m.index, m.index + m[0].length),
      });
    }
  }
  return out;
}

export interface ExtractOptions {
  gazetteer?: GazetteerMap;
  coref?: boolean;
  // Neural NER mentions from src/nlp/ner.ts, pre-computed by the caller
  // because the model is async. Omit for regex-only extraction.
  nerMentions?: NerMention[];
}

// Convert neural NER char-offset mentions into the internal Mention shape,
// building proper TranscriptSpans so downstream code sees no difference
// from a regex/gazetteer-sourced mention.
function nerToMentions(
  ner: NerMention[],
  transcript: Transcript,
  cueStarts: number[],
): Mention[] {
  const out: Mention[] = [];
  for (const n of ner) {
    // Prefer the canonical form supplied by src/nlp/canonicalize.ts; fall
    // back to the raw surface for callers (mostly tests) that skip the
    // canonicalization pass. Strip subword artefacts ("##") defensively.
    const canonical = (n.canonical ?? n.surface).replace(/##/g, "").trim();
    if (!canonical) continue;
    out.push({
      type: n.type,
      surface: n.surface,
      canonical,
      span: makeSpan(transcript, cueStarts, n.start, n.end),
    });
  }
  return out;
}

export function extract(
  transcript: Transcript,
  opts: ExtractOptions = {},
): Entity[] {
  const gaz = opts.gazetteer ?? DEFAULT_GAZETTEER;
  const flat = flatten(transcript);
  const { text, cueStarts } = flat;
  const mentions: Mention[] = [
    ...nerToMentions(opts.nerMentions ?? [], transcript, cueStarts),
    ...timeMentions(text, transcript, cueStarts),
    ...gazetteerMentions("organization", gaz.organization, text, transcript, cueStarts),
    ...gazetteerMentions("location", gaz.location, text, transcript, cueStarts),
  ];
  const entities = normalize(mentions);
  if (opts.coref === false) return entities;
  return resolveCoreferences(transcript, entities, flat);
}

// Fold mentions with the same (type, canonical) into a single entity and
// accumulate their spans. Case-insensitive keying so "Vaccine" and "vaccine"
// merge.
export function normalize(mentions: Mention[]): Entity[] {
  const byKey = new Map<string, Entity>();
  for (const m of mentions) {
    const key = `${m.type}:${m.canonical.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.mentions.push(m.span);
      if (!existing.aliases.includes(m.surface) && m.surface !== m.canonical) {
        existing.aliases.push(m.surface);
      }
    } else {
      byKey.set(key, {
        id: key,
        type: m.type,
        canonical: m.canonical,
        aliases: m.surface === m.canonical ? [] : [m.surface],
        mentions: [m.span],
      });
    }
  }
  return [...byKey.values()];
}
