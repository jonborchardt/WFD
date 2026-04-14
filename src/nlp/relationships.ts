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

type EntityType = Entity["type"];

interface Pattern {
  predicate: RelationshipType;
  re: RegExp;
  // Allowed entity types for subject and object. A predicate is only emitted
  // when both sides match. Keeps `married 2004` / `located-at 2004` bugs from
  // slipping through when `in 2004` triggers the located-at cue.
  subj: EntityType[];
  obj: EntityType[];
}

const AGENT: EntityType[] = ["person", "organization"];
const PLACE: EntityType[] = ["location", "organization"];
const THING: EntityType[] = ["misc", "organization"];
const ANY: EntityType[] = ["person", "misc", "time", "location", "organization"];

const PATTERNS: Pattern[] = [
  { predicate: "born-in", re: /\bborn in\b/i, subj: ["person"], obj: ["location", "time"] },
  { predicate: "died-in", re: /\b(died in|passed away in)\b/i, subj: ["person"], obj: ["location", "time"] },
  { predicate: "married", re: /\b(married to|married|wed|engaged to)\b/i, subj: ["person"], obj: ["person"] },
  { predicate: "lived-with", re: /\b(lived with|lives with|cohabitated with)\b/i, subj: ["person"], obj: ["person"] },
  { predicate: "funded-by", re: /\b(funded by|financed by|backed by|bankrolled by|paid by)\b/i, subj: AGENT, obj: AGENT },
  { predicate: "funds", re: /\b(funds|funded|finances|financed|bankrolls|bankrolled)\b/i, subj: AGENT, obj: AGENT },
  { predicate: "founded", re: /\b(founded|co-?founded|established|started)\b/i, subj: ["person"], obj: ["organization"] },
  { predicate: "owns", re: /\b(owns|owned|acquired|purchased|bought)\b/i, subj: AGENT, obj: THING },
  { predicate: "employs", re: /\b(hired|hires|employs|employed)\b/i, subj: AGENT, obj: ["person"] },
  { predicate: "worked-for", re: /\b(worked for|works for|employed by|staff of|on the staff of)\b/i, subj: ["person"], obj: AGENT },
  { predicate: "member-of", re: /\b(member of|belongs to|part of|sits on)\b/i, subj: ["person"], obj: ["organization"] },
  { predicate: "met", re: /\b(met with|met|spoke with|sat down with)\b/i, subj: ["person"], obj: ["person"] },
  { predicate: "knows", re: /\b(knows|knew|acquainted with|friends with|close to)\b/i, subj: ["person"], obj: ["person"] },
  { predicate: "attended", re: /\b(attended|present at|was at)\b/i, subj: ["person"], obj: ["misc", "location"] },
  { predicate: "visited", re: /\b(visited|traveled to|flew to|went to)\b/i, subj: ["person"], obj: ["location", "organization"] },
  { predicate: "near", re: /\b(near|close to|just outside|adjacent to)\b/i, subj: PLACE, obj: PLACE },
  { predicate: "during", re: /\b(during|in the midst of|amid|amidst)\b/i, subj: ANY, obj: ["misc", "time"] },
  { predicate: "loves", re: /\b(loves|loved|adores|admires)\b/i, subj: ["person"], obj: ["person", "misc"] },
  { predicate: "hates", re: /\b(hates|hated|despises|loathes)\b/i, subj: ["person"], obj: ["person", "misc"] },
  { predicate: "accused", re: /\b(accused|charged|blamed|alleged)\b/i, subj: AGENT, obj: AGENT },
  { predicate: "denied", re: /\b(denied|rejected|refuted|dismissed)\b/i, subj: AGENT, obj: ANY },
  { predicate: "investigated", re: /\b(investigated|probed|looked into|examined)\b/i, subj: AGENT, obj: ANY },
  { predicate: "researches", re: /\b(researches|researched|studies|studied)\b/i, subj: AGENT, obj: THING },
  { predicate: "authored", re: /\b(authored|wrote|penned|co-?authored)\b/i, subj: ["person"], obj: THING },
  { predicate: "cited", re: /\b(cited|quoted|referenced)\b/i, subj: AGENT, obj: AGENT },
  { predicate: "interested-in", re: /\b(interested in|focused on|fascinated by)\b/i, subj: ["person"], obj: THING },
  { predicate: "said", re: /\b(said|told|claimed|stated|argued|reported|testified)\b/i, subj: AGENT, obj: ANY },
  { predicate: "located-at", re: /\b(in|at|based in|headquartered in)\b/i, subj: ANY, obj: ["location", "organization"] },
  { predicate: "related-to", re: /\b(related to|tied to|connected to|linked to)\b/i, subj: ANY, obj: ANY },
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
          // Honor the subject/object type constraints. Try both
          // orientations (left→right and right→left) so a pair like
          // (time, person) with "said" still fires person→said→time if the
          // predicate allows it — but `located-at 2004` is blocked because
          // `time` is not in its object list in either orientation.
          const leftMatchesSubj = pat.subj.includes(left.entity.type);
          const rightMatchesObj = pat.obj.includes(right.entity.type);
          const rightMatchesSubj = pat.subj.includes(right.entity.type);
          const leftMatchesObj = pat.obj.includes(left.entity.type);
          let subj = left, obj = right;
          if (leftMatchesSubj && rightMatchesObj) {
            // default orientation
          } else if (rightMatchesSubj && leftMatchesObj) {
            subj = right;
            obj = left;
          } else {
            continue; // type-incompatible, skip
          }
          const evidence: TranscriptSpan = {
            transcriptId: transcript.videoId,
            charStart: Math.min(subj.span.charStart, obj.span.charStart),
            charEnd: Math.max(subj.span.charEnd, obj.span.charEnd),
            timeStart: Math.min(subj.span.timeStart, obj.span.timeStart),
            timeEnd: Math.max(subj.span.timeEnd, obj.span.timeEnd),
          };
          const confidence = Math.max(
            minConfidence,
            Math.min(0.9, 1 - between.length / 120),
          );
          out.push(
            createRelationship({
              subjectId: subj.entity.id,
              predicate: pat.predicate,
              objectId: obj.entity.id,
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
