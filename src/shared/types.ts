// Cross-cutting types used across modules.

export interface TranscriptSpan {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
}

export interface Entity {
  id: string;
  type: "person" | "thing" | "time" | "event" | "location" | "organization";
  canonical: string;
  aliases: string[];
  mentions: TranscriptSpan[];
}

export type RelationshipType =
  | "said"
  | "met"
  | "attended"
  | "worked-for"
  | "located-at"
  | "related-to"
  | "member-of";

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
