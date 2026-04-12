import { describe, it, expect } from "vitest";
import { extract } from "../src/nlp/entities.ts";
import {
  extractRelationships,
  createRelationship,
  isValidRelationship,
} from "../src/nlp/relationships.ts";

const fixture = {
  videoId: "relfix",
  cues: [
    {
      start: 0,
      duration: 3,
      text: "President Biden met with Angela Merkel in Berlin.",
    },
    {
      start: 3,
      duration: 3,
      text: "Angela Merkel said the vaccine rollout was successful.",
    },
  ],
};

describe("relationship extraction", () => {
  it("emits relationships with full evidence pointers", () => {
    const entities = extract(fixture);
    const rels = extractRelationships(fixture, entities);
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(isValidRelationship(r)).toBe(true);
      expect(r.evidence.transcriptId).toBe("relfix");
      expect(r.evidence.timeEnd).toBeGreaterThanOrEqual(r.evidence.timeStart);
    }
  });

  it("captures the met/said patterns", () => {
    const entities = extract(fixture);
    const rels = extractRelationships(fixture, entities);
    const predicates = rels.map((r) => r.predicate);
    expect(predicates).toContain("met");
    expect(predicates).toContain("said");
  });

  it("refuses to construct a relationship without evidence", () => {
    expect(() =>
      createRelationship({
        subjectId: "a",
        predicate: "said",
        objectId: "b",
        evidence: undefined as any,
        confidence: 0.5,
      }),
    ).toThrow(/evidence/);
  });

  it("confidence is bounded in [minConfidence, 0.9]", () => {
    const entities = extract(fixture);
    const rels = extractRelationships(fixture, entities, { minConfidence: 0.3 });
    for (const r of rels) {
      expect(r.confidence).toBeGreaterThanOrEqual(0.3);
      expect(r.confidence).toBeLessThanOrEqual(0.9);
    }
  });
});
