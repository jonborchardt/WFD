// Local types for the neural relations stage. Self-contained for the
// same reason src/entities/types.ts is: the shared RelationshipType union
// in src/shared/types.ts is frozen at the legacy 28 regex predicates and
// we are rewriting the predicate schema as part of this refactor.
//
// When the old src/nlp/ module is deleted, the shared type will be
// broadened to match PredicateName below.

import type { EntitySpan } from "../entities/types.js";

// Name of a relation predicate. Source of truth is
// config/relation-labels.json at runtime; this string alias exists so
// types elsewhere can document intent.
export type PredicateName = string;

export interface PredicateConfig {
  name: PredicateName;
  threshold: number;
}

// One scored edge produced by GLiREL for a specific (subject, object,
// predicate) triple. Endpoints reference entity-mention ids from the
// same transcript's data/entities/<id>.json output.
export interface RelationEdge {
  id: string;                    // stable within file: "r_0001"
  predicate: PredicateName;
  subjectMentionId: string;      // references PersistedEntities.mentions[].id
  objectMentionId: string;       // references PersistedEntities.mentions[].id
  score: number;                 // 0..1, from GLiREL
  evidence: EntitySpan;          // the sentence span enclosing both mentions
}

export interface PersistedRelations {
  schemaVersion: 1;
  transcriptId: string;
  model: string;
  modelVersion: string | null;
  predicatesUsed: PredicateName[];
  generatedAt: string;           // ISO 8601
  edges: RelationEdge[];
}

// What GLiREL (or a test fake) returns when asked to score one (pair,
// predicate) tuple, or a batched variant. Score is 0..1.
export interface GlirelRawScore {
  subjectIndex: number;          // index into the `entities` array passed in
  objectIndex: number;
  predicate: PredicateName;
  score: number;
}

// The payload shape we hand to the backend per sentence. Backends that
// support batching can flatten multiple sentences; backends that don't
// consume one of these at a time.
export interface GlirelSentenceInput {
  text: string;                  // the sentence text as extracted
  // Entity spans relative to this sentence's local char frame.
  entities: Array<{
    start: number;
    end: number;
    label: string;
    surface: string;
  }>;
  predicates: PredicateName[];
}
