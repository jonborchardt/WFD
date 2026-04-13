// Lightweight coreference resolution for persons.
//
// Two conservative passes, run after entity extraction:
//
// 1. Last-name / first-name: for each multi-token person, add mentions of
//    standalone name tokens (>=4 chars) elsewhere in the transcript, as long
//    as no other person shares that token.
// 2. Pronoun: bind he/she/him/her/his/hers to the single preceding person
//    mention within a one-cue window. If more than one distinct person is in
//    that window, skip — ambiguity is louder than recall here.
//
// they/them/their are deliberately excluded: in this corpus they usually
// refer to groups, not to a prior named person, and binding them wrong
// corrupts the downstream truthiness layer.
//
// New mentions reuse the antecedent entity's id, so the relationship
// extractor sees them as additional spans of the same entity. Evidence
// pointers remain exact (char spans + cue times).

import { Entity, TranscriptSpan } from "../shared/types.js";
import type { Transcript } from "./entities.js";

interface Flat {
  text: string;
  cueStarts: number[];
}

function cueIdxFor(cueStarts: number[], offset: number): number {
  let best = 0;
  for (let i = 0; i < cueStarts.length; i++) {
    if (cueStarts[i] <= offset) best = i;
    else break;
  }
  return best;
}

function spanAt(
  transcript: Transcript,
  cueStarts: number[],
  charStart: number,
  charEnd: number,
): TranscriptSpan {
  const cueIdx = cueIdxFor(cueStarts, charStart);
  const cue = transcript.cues[cueIdx];
  return {
    transcriptId: transcript.videoId,
    charStart,
    charEnd,
    timeStart: cue.start,
    timeEnd: cue.start + cue.duration,
  };
}

function anyOverlap(entities: Entity[], s: number, e: number): boolean {
  for (const ent of entities) {
    for (const m of ent.mentions) {
      if (m.charStart < e && m.charEnd > s) return true;
    }
  }
  return false;
}

function addMention(entity: Entity, span: TranscriptSpan, surface: string) {
  entity.mentions.push(span);
  if (surface && surface !== entity.canonical && !entity.aliases.includes(surface)) {
    entity.aliases.push(surface);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PRONOUN_RE = /\b(he|she|him|her|his|hers)\b/gi;

export function resolveCoreferences(
  transcript: Transcript,
  entities: Entity[],
  flat: Flat,
): Entity[] {
  const persons = entities.filter((e) => e.type === "person");
  if (persons.length === 0) return entities;
  const { text, cueStarts } = flat;

  // Phase 1: last-name / first-name.
  for (const p of persons) {
    const tokens = p.canonical
      .split(/\s+/)
      .filter((t) => /^[A-Z][a-z]+$/.test(t));
    if (tokens.length < 2) continue;
    for (const tok of tokens) {
      if (tok.length < 4) continue;
      const ambiguous = persons.some(
        (other) =>
          other.id !== p.id && other.canonical.split(/\s+/).includes(tok),
      );
      if (ambiguous) continue;
      const re = new RegExp(`\\b${escapeRe(tok)}\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const s = m.index;
        const e = s + tok.length;
        if (anyOverlap(entities, s, e)) continue;
        addMention(p, spanAt(transcript, cueStarts, s, e), tok);
      }
    }
  }

  // Phase 2: pronouns.
  const personMentions: Array<{ entity: Entity; span: TranscriptSpan }> = [];
  for (const p of persons) {
    for (const m of p.mentions) personMentions.push({ entity: p, span: m });
  }
  personMentions.sort((a, b) => a.span.charStart - b.span.charStart);

  PRONOUN_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PRONOUN_RE.exec(text))) {
    const pronStart = pm.index;
    const pronEnd = pronStart + pm[0].length;
    if (anyOverlap(entities, pronStart, pronEnd)) continue;
    const pronCue = cueIdxFor(cueStarts, pronStart);

    let antecedent: { entity: Entity; span: TranscriptSpan } | null = null;
    for (let i = personMentions.length - 1; i >= 0; i--) {
      if (personMentions[i].span.charEnd <= pronStart) {
        antecedent = personMentions[i];
        break;
      }
    }
    if (!antecedent) continue;
    const antCue = cueIdxFor(cueStarts, antecedent.span.charStart);
    if (pronCue - antCue > 1) continue;

    const windowDistinct = new Set(
      personMentions
        .filter((x) => {
          if (x.span.charEnd > pronStart) return false;
          const cue = cueIdxFor(cueStarts, x.span.charStart);
          return pronCue - cue <= 1;
        })
        .map((x) => x.entity.id),
    );
    if (windowDistinct.size > 1) continue;

    const newSpan = spanAt(transcript, cueStarts, pronStart, pronEnd);
    addMention(antecedent.entity, newSpan, pm[0]);
    personMentions.push({ entity: antecedent.entity, span: newSpan });
    personMentions.sort((a, b) => a.span.charStart - b.span.charStart);
  }

  return entities;
}
