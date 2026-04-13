// Entity extraction from transcripts.
//
// Library choice: no external NLP dependency. We use a rule-based extractor
// that walks cues, matches gazetteers + capitalization patterns, and emits
// character-span offsets. A heavier model (spaCy, wink-nlp, compromise) can
// be dropped in behind this same interface later without touching callers —
// that's the reason extract() takes a Transcript and returns typed Entity[].
//
// Entity types emitted: person, thing, time, event, location, organization.
// The rules here are intentionally conservative: precision > recall, because
// the downstream graph and truthiness layers amplify false positives.

import { Entity, TranscriptSpan } from "../shared/types.js";
import { resolveCoreferences } from "./coref.js";

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
  event: ["World War II", "Cold War", "9/11", "Brexit"],
  thing: ["vaccine", "oil", "budget", "treaty"],
};

export interface GazetteerMap {
  organization: string[];
  location: string[];
  event: string[];
  thing: string[];
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

// Person detector: consecutive Capitalized words of length >=2, optionally
// prefixed by an honorific. Skips sentence-initial single capitalized words
// by requiring at least two capitalized tokens or a recognized honorific.
const HONORIFICS = ["Mr", "Mrs", "Ms", "Dr", "Sen", "Rep", "Gov", "Pres", "President"];

function personMentions(
  text: string,
  transcript: Transcript,
  cueStarts: number[],
): Mention[] {
  const out: Mention[] = [];
  const re =
    /\b((?:(?:Mr|Mrs|Ms|Dr|Sen|Rep|Gov|Pres|President)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const surface = m[1];
    const canonical = surface.replace(/^(?:Mr|Mrs|Ms|Dr|Sen|Rep|Gov|Pres|President)\.?\s+/, "");
    out.push({
      type: "person",
      surface,
      canonical,
      span: makeSpan(transcript, cueStarts, m.index, m.index + surface.length),
    });
  }
  // Honorific followed by single capitalized word also counts as a person.
  const honRe = new RegExp(
    `\\b(?:${HONORIFICS.join("|")})\\.?\\s+([A-Z][a-z]+)\\b`,
    "g",
  );
  while ((m = honRe.exec(text))) {
    out.push({
      type: "person",
      surface: m[0],
      canonical: m[1],
      span: makeSpan(transcript, cueStarts, m.index, m.index + m[0].length),
    });
  }
  return out;
}

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
}

export function extract(
  transcript: Transcript,
  opts: ExtractOptions = {},
): Entity[] {
  const gaz = opts.gazetteer ?? DEFAULT_GAZETTEER;
  const flat = flatten(transcript);
  const { text, cueStarts } = flat;
  const mentions: Mention[] = [
    ...personMentions(text, transcript, cueStarts),
    ...timeMentions(text, transcript, cueStarts),
    ...gazetteerMentions("organization", gaz.organization, text, transcript, cueStarts),
    ...gazetteerMentions("location", gaz.location, text, transcript, cueStarts),
    ...gazetteerMentions("event", gaz.event, text, transcript, cueStarts),
    ...gazetteerMentions("thing", gaz.thing, text, transcript, cueStarts),
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
