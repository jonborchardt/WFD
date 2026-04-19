// Cross-cutting types used across modules.
//
// The type and predicate unions below were widened as part of the
// neural extraction migration (GLiNER entities + GLiREL relations
// replaced the regex+BERT pipeline). If you need more labels or
// predicates, add them here and at the same time to
// `config/entity-labels.json` and `config/relation-labels.json`.

export interface TranscriptSpan {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
}

// Entity label union. Matches config/entity-labels.json at runtime;
// keep the two in sync. The old 5-label CoNLL-ish set
// (person/organization/location/time/misc) is a subset of this wider
// set, so any older persisted data still type-checks.
export type EntityLabel =
  | "person"
  | "organization"
  | "group_or_movement"
  | "location"
  | "facility"
  | "event"
  | "date_time"
  | "role"
  | "technology"
  | "work_of_media"
  | "law_or_policy"
  | "ideology"
  | "nationality_or_ethnicity"
  | "quantity"
  // Derived from date_time mentions by the date-normalize stage. Not
  // GLiNER labels; never sent to the sidecar. See src/date_normalize/.
  | "time_of_day"
  | "specific_date_time"
  | "specific_week"
  | "specific_month"
  | "year"
  | "decade";

export interface Entity {
  id: string;
  type: EntityLabel;
  canonical: string;
  aliases: string[];
  mentions: TranscriptSpan[];
}

// Relation predicate union. Source of truth at runtime is
// config/relation-labels.json — this union exists for compile-time
// narrowing where it matters (contradictions, truth rules).
export type RelationshipType =
  | "works_for"
  | "founded"
  | "member_of"
  | "led_by"
  | "located_in"
  | "born_in"
  | "died_in"
  | "operates_in"
  | "met_with"
  | "allied_with"
  | "opposed_by"
  | "funded_by"
  | "accused_of"
  | "investigated_by"
  | "prosecuted_by"
  | "convicted_of"
  | "said"
  | "believes"
  | "endorses"
  | "denies"
  | "authored"
  | "created"
  | "published"
  | "influenced_by"
  | "part_of"
  | "succeeded_by"
  | "occurred_on"
  | "caused"
  | "resulted_in";

export type Provenance = "nlp" | "ai" | "both";

export interface Relationship {
  id: string;
  subjectId: string;
  predicate: RelationshipType;
  objectId: string;
  evidence: TranscriptSpan;
  confidence: number;
  provenance: Provenance;
  directTruth?: number;
  derivedTruth?: number;
}

// Validator used by graph store and by AI-enrichment ingest. Kept in
// the shared types module so every consumer gets the same contract —
// previously lived in src/nlp/relationships.ts, which is being deleted.
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

// Factory for a fresh Relationship. Enforces the evidence invariant —
// every relationship MUST carry a transcript-span pointer. Previously
// lived in src/nlp/relationships.ts.
export function createRelationship(args: {
  subjectId: string;
  predicate: RelationshipType;
  objectId: string;
  evidence: TranscriptSpan;
  confidence: number;
  provenance?: Provenance;
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
  const id = `${args.subjectId}|${args.predicate}|${args.objectId}|${spanKey}`;
  return {
    id,
    subjectId: args.subjectId,
    predicate: args.predicate,
    objectId: args.objectId,
    evidence: args.evidence,
    confidence: args.confidence,
    provenance: args.provenance ?? "nlp",
  };
}
