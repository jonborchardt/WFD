// Relationship extraction.
//
// Approach: segment the flattened transcript into sentences, then for each
// sentence pair up entities whose mentions fall inside it and match a
// predicate pattern against the between-text (the substring lying strictly
// between the two mentions). Every relationship MUST carry an evidence
// pointer — this is the load-bearing project invariant, and the constructor
// refuses to return a Relationship without one.
//
// Pattern order matters: more specific cues are listed first so "born in"
// does not get swallowed by the generic "in" (located-at) pattern, and
// "worked for" wins over "member of" when both could apply.

import { Entity, Relationship, RelationshipType, TranscriptSpan } from "../shared/types.js";
import { Transcript, flatten } from "./entities.js";
import { segmentSentences } from "./sentences.js";

interface Pattern {
  predicate: RelationshipType;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { predicate: "born-in", re: /\bborn in\b/i },
  { predicate: "died-in", re: /\b(died in|passed away in)\b/i },
  { predicate: "married", re: /\b(married to|married|wed|engaged to)\b/i },
  { predicate: "lived-with", re: /\b(lived with|lives with|cohabitated with)\b/i },
  { predicate: "funded-by", re: /\b(funded by|financed by|backed by|bankrolled by|paid by)\b/i },
  { predicate: "funds", re: /\b(funds|funded|finances|financed|bankrolls|bankrolled)\b/i },
  { predicate: "founded", re: /\b(founded|co-?founded|established|started)\b/i },
  { predicate: "owns", re: /\b(owns|owned|acquired|purchased|bought)\b/i },
  { predicate: "employs", re: /\b(hired|hires|employs|employed)\b/i },
  { predicate: "worked-for", re: /\b(worked for|works for|employed by|staff of|on the staff of)\b/i },
  { predicate: "member-of", re: /\b(member of|belongs to|part of|sits on)\b/i },
  { predicate: "met", re: /\b(met with|met|spoke with|sat down with)\b/i },
  { predicate: "knows", re: /\b(knows|knew|acquainted with|friends with|close to)\b/i },
  { predicate: "attended", re: /\b(attended|present at|was at)\b/i },
  { predicate: "visited", re: /\b(visited|traveled to|flew to|went to)\b/i },
  { predicate: "near", re: /\b(near|close to|just outside|adjacent to)\b/i },
  { predicate: "during", re: /\b(during|in the midst of|amid|amidst)\b/i },
  { predicate: "loves", re: /\b(loves|loved|adores|admires)\b/i },
  { predicate: "hates", re: /\b(hates|hated|despises|loathes)\b/i },
  { predicate: "accused", re: /\b(accused|charged|blamed|alleged)\b/i },
  { predicate: "denied", re: /\b(denied|rejected|refuted|dismissed)\b/i },
  { predicate: "investigated", re: /\b(investigated|probed|looked into|examined)\b/i },
  { predicate: "researches", re: /\b(researches|researched|studies|studied)\b/i },
  { predicate: "authored", re: /\b(authored|wrote|penned|co-?authored)\b/i },
  { predicate: "cited", re: /\b(cited|quoted|referenced)\b/i },
  { predicate: "interested-in", re: /\b(interested in|focused on|fascinated by)\b/i },
  { predicate: "said", re: /\b(said|told|claimed|stated|argued|reported|testified)\b/i },
  { predicate: "located-at", re: /\b(in|at|based in|headquartered in)\b/i },
  { predicate: "related-to", re: /\b(related to|tied to|connected to|linked to)\b/i },
];

export interface ExtractRelsOptions {
  minConfidence?: number;
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
  const { text } = flatten(transcript);
  const sentences = segmentSentences(text);
  const out: Relationship[] = [];

  // Build a flat, sorted list of (entity, span) once; then for each sentence
  // binary-scan the slice that lands inside it. Cheaper than re-scanning
  // every entity per sentence.
  const allMentions: Array<{ entity: Entity; span: TranscriptSpan }> = [];
  for (const e of entities) {
    for (const s of e.mentions) allMentions.push({ entity: e, span: s });
  }
  allMentions.sort((a, b) => a.span.charStart - b.span.charStart);

  for (const sent of sentences) {
    const inSent: typeof allMentions = [];
    for (const m of allMentions) {
      if (m.span.charStart >= sent.start && m.span.charEnd <= sent.end) {
        inSent.push(m);
      } else if (m.span.charStart >= sent.end) {
        break;
      }
    }
    if (inSent.length < 2) continue;

    for (let a = 0; a < inSent.length; a++) {
      for (let b = a + 1; b < inSent.length; b++) {
        const left = inSent[a];
        const right = inSent[b];
        if (left.entity.id === right.entity.id) continue;
        const between = text.slice(left.span.charEnd, right.span.charStart);
        if (between.length === 0 || between.length > 120) continue;
        for (const pat of PATTERNS) {
          if (!pat.re.test(between)) continue;
          const evidence: TranscriptSpan = {
            transcriptId: transcript.videoId,
            charStart: left.span.charStart,
            charEnd: right.span.charEnd,
            timeStart: left.span.timeStart,
            timeEnd: right.span.timeEnd,
          };
          const confidence = Math.max(
            minConfidence,
            Math.min(0.9, 1 - between.length / 120),
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
          break; // one predicate per pair per sentence
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
