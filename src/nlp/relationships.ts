// Relationship extraction.
//
// Approach: for each cue, consider pairs of entities whose mentions fall in
// that cue, and match a small set of predicate patterns between their surface
// positions. Every relationship MUST carry an evidence pointer — this is the
// load-bearing project invariant, and the constructor enforces it by
// refusing to return a Relationship without one.

import { Entity, Relationship, RelationshipType, TranscriptSpan } from "../shared/types.js";
import { Transcript, flatten } from "./entities.js";

interface Pattern {
  predicate: RelationshipType;
  // Regex run against the *between-text* (the substring of the transcript
  // lying strictly between the two entity mentions).
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { predicate: "said", re: /\b(said|told|claimed|stated|argued|wrote)\b/i },
  { predicate: "met", re: /\b(met with|met|spoke with|sat down with)\b/i },
  { predicate: "attended", re: /\b(attended|joined|was at|was present at)\b/i },
  { predicate: "worked-for", re: /\b(worked for|works for|employed by|joined)\b/i },
  { predicate: "located-at", re: /\b(in|at|based in|headquartered in)\b/i },
  { predicate: "member-of", re: /\b(member of|belongs to|part of)\b/i },
];

export interface ExtractRelsOptions {
  minConfidence?: number;
}

function spanOverlapsCue(span: TranscriptSpan, cueStart: number, cueEnd: number): boolean {
  return span.charStart >= cueStart && span.charEnd <= cueEnd;
}

function makeId(
  subjectId: string,
  predicate: RelationshipType,
  objectId: string,
  spanKey: string,
): string {
  return `${subjectId}|${predicate}|${objectId}|${spanKey}`;
}

export function createRelationship(args: {
  subjectId: string;
  predicate: RelationshipType;
  objectId: string;
  evidence: TranscriptSpan;
  confidence: number;
}): Relationship {
  if (!args.evidence) {
    throw new Error("relationship requires evidence — invariant violated");
  }
  if (
    typeof args.evidence.transcriptId !== "string" ||
    args.evidence.charEnd < args.evidence.charStart
  ) {
    throw new Error("relationship evidence pointer is malformed");
  }
  const spanKey = `${args.evidence.transcriptId}:${args.evidence.charStart}-${args.evidence.charEnd}`;
  return {
    id: makeId(args.subjectId, args.predicate, args.objectId, spanKey),
    subjectId: args.subjectId,
    predicate: args.predicate,
    objectId: args.objectId,
    evidence: args.evidence,
    confidence: args.confidence,
    provenance: "nlp",
  };
}

export function extractRelationships(
  transcript: Transcript,
  entities: Entity[],
  opts: ExtractRelsOptions = {},
): Relationship[] {
  const minConfidence = opts.minConfidence ?? 0.2;
  const { text, cueStarts } = flatten(transcript);
  const out: Relationship[] = [];
  for (let i = 0; i < transcript.cues.length; i++) {
    const cueStart = cueStarts[i];
    const cueEnd =
      i + 1 < cueStarts.length ? cueStarts[i + 1] - 1 : text.length;
    // Collect (entity, span) pairs that land in this cue, sorted by charStart.
    const inCue: Array<{ entity: Entity; span: TranscriptSpan }> = [];
    for (const e of entities) {
      for (const s of e.mentions) {
        if (spanOverlapsCue(s, cueStart, cueEnd)) inCue.push({ entity: e, span: s });
      }
    }
    inCue.sort((a, b) => a.span.charStart - b.span.charStart);
    for (let a = 0; a < inCue.length; a++) {
      for (let b = a + 1; b < inCue.length; b++) {
        const left = inCue[a];
        const right = inCue[b];
        if (left.entity.id === right.entity.id) continue;
        const between = text.slice(left.span.charEnd, right.span.charStart);
        if (between.length === 0 || between.length > 80) continue;
        for (const pat of PATTERNS) {
          if (!pat.re.test(between)) continue;
          const evidence: TranscriptSpan = {
            transcriptId: transcript.videoId,
            charStart: left.span.charStart,
            charEnd: right.span.charEnd,
            timeStart: left.span.timeStart,
            timeEnd: right.span.timeEnd,
          };
          // Confidence heuristic: shorter between-text + closer time → higher.
          const confidence = Math.max(
            minConfidence,
            Math.min(0.9, 1 - between.length / 80),
          );
          out.push(
            createRelationship({
              subjectId: left.entity.id,
              predicate: pat.predicate,
              objectId: right.entity.id,
              evidence,
              confidence,
            }),
          );
          break; // one predicate per pair per cue
        }
      }
    }
  }
  return dedupe(out);
}

function dedupe(rels: Relationship[]): Relationship[] {
  const byId = new Map<string, Relationship>();
  for (const r of rels) {
    const existing = byId.get(r.id);
    if (!existing || r.confidence > existing.confidence) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// Shape validator used by tests + AI-enrichment ingest.
export function isValidRelationship(r: unknown): r is Relationship {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  const ev = o.evidence as Record<string, unknown> | undefined;
  return (
    typeof o.id === "string" &&
    typeof o.subjectId === "string" &&
    typeof o.objectId === "string" &&
    typeof o.predicate === "string" &&
    typeof o.confidence === "number" &&
    !!ev &&
    typeof ev.transcriptId === "string" &&
    typeof ev.charStart === "number" &&
    typeof ev.charEnd === "number"
  );
}
