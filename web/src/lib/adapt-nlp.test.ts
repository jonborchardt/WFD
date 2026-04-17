import { describe, it, expect } from "vitest";
import { adaptNlp } from "./adapt-nlp";
import type { PersistedEntities, PersistedRelations, TranscriptSpan } from "../types";

const span = (timeStart = 0): TranscriptSpan => ({
  transcriptId: "t1", charStart: 0, charEnd: 5, timeStart, timeEnd: timeStart + 1,
});

describe("adaptNlp", () => {
  it("groups mentions of same (label, canonical) into one entity", () => {
    const ents: PersistedEntities = {
      schemaVersion: 1,
      transcriptId: "t1",
      model: "gliner",
      mentions: [
        { id: "m1", label: "person", surface: "Dan", canonical: "Dan", span: span(1), score: 0.9 },
        { id: "m2", label: "person", surface: "dan", canonical: "Dan", span: span(2), score: 0.8 },
      ],
    };
    const nlp = adaptNlp(ents, null);
    expect(nlp.entities).toHaveLength(1);
    expect(nlp.entities[0].canonical).toBe("Dan");
    expect(nlp.entities[0].mentions).toHaveLength(2);
  });

  it("reads `evidence` (not `span`) from persisted edges", () => {
    const ents: PersistedEntities = {
      schemaVersion: 1, transcriptId: "t1", model: "gliner",
      mentions: [
        { id: "m1", label: "person", surface: "A", canonical: "A", span: span(), score: 0.9 },
        { id: "m2", label: "location", surface: "B", canonical: "B", span: span(), score: 0.9 },
      ],
    };
    const rels: PersistedRelations = {
      schemaVersion: 1, transcriptId: "t1", model: "glirel",
      edges: [
        { id: "r1", predicate: "located_in", subjectMentionId: "m1", objectMentionId: "m2", score: 0.7, evidence: span(42) },
      ],
    };
    const nlp = adaptNlp(ents, rels);
    expect(nlp.relationships).toHaveLength(1);
    expect(nlp.relationships[0].evidence.timeStart).toBe(42);
    expect(nlp.relationships[0].subjectId).toBe("person:a");
    expect(nlp.relationships[0].objectId).toBe("location:b");
  });

  it("skips edges whose mention ids don't resolve", () => {
    const ents: PersistedEntities = {
      schemaVersion: 1, transcriptId: "t1", model: "gliner",
      mentions: [
        { id: "m1", label: "person", surface: "A", canonical: "A", span: span(), score: 0.9 },
      ],
    };
    const rels: PersistedRelations = {
      schemaVersion: 1, transcriptId: "t1", model: "glirel",
      edges: [
        { id: "r1", predicate: "knows", subjectMentionId: "m1", objectMentionId: "m_missing", score: 0.5, evidence: span() },
      ],
    };
    const nlp = adaptNlp(ents, rels);
    expect(nlp.relationships).toHaveLength(0);
  });

  it("returns no relationships when rels is null", () => {
    const ents: PersistedEntities = {
      schemaVersion: 1, transcriptId: "t1", model: "gliner", mentions: [],
    };
    const nlp = adaptNlp(ents, null);
    expect(nlp.relationships).toEqual([]);
    expect(nlp.entities).toEqual([]);
  });
});
