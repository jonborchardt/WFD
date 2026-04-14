import { describe, it, expect } from "vitest";
import { extract, flatten } from "../src/nlp/entities.ts";
import {
  extractRelationships,
  createRelationship,
  isValidRelationship,
} from "../src/nlp/relationships.ts";
import { synthesizeNer } from "./helpers/fake-ner.ts";

function ex(t: Parameters<typeof extract>[0]) {
  const { text } = flatten(t);
  return extract(t, { nerMentions: synthesizeNer(text) });
}

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
    {
      start: 6,
      duration: 3,
      text: "John Smith founded OpenAI and later accused Sam Altman.",
    },
    {
      start: 9,
      duration: 3,
      text: "Jane Doe investigated the FBI during the Cold War.",
    },
  ],
};

describe("relationship extraction", () => {
  it("emits relationships with full evidence pointers", () => {
    const entities = ex(fixture);
    const rels = extractRelationships(fixture, entities);
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(isValidRelationship(r)).toBe(true);
      expect(r.evidence.transcriptId).toBe("relfix");
      expect(r.evidence.timeEnd).toBeGreaterThanOrEqual(r.evidence.timeStart);
    }
  });

  it("captures the met/said patterns", () => {
    const entities = ex(fixture);
    const rels = extractRelationships(fixture, entities);
    const predicates = rels.map((r) => r.predicate);
    expect(predicates).toContain("met");
    expect(predicates).toContain("said");
  });

  it("captures expanded predicates (founded, accused, investigated, during)", () => {
    const entities = ex(fixture);
    const rels = extractRelationships(fixture, entities);
    const predicates = new Set(rels.map((r) => r.predicate));
    expect(predicates.has("founded")).toBe(true);
    expect(predicates.has("accused")).toBe(true);
    expect(predicates.has("investigated")).toBe(true);
    expect(predicates.has("during")).toBe(true);
  });

  it("refuses to pair a person with a year for `located-at`", () => {
    // "Sunny located-at 2004" was a real misfire on the old pattern table.
    // A time entity must never end up on the object side of located-at.
    const t = {
      videoId: "typefilter",
      cues: [
        { start: 0, duration: 3, text: "Cheryl and Sunny married in 2004." },
      ],
    };
    const entities = ex(t);
    const rels = extractRelationships(t, entities);
    const bad = rels.find(
      (r) => r.predicate === "located-at" && r.objectId.startsWith("time:"),
    );
    expect(bad).toBeUndefined();
    const badMarried = rels.find(
      (r) => r.predicate === "married" && r.objectId.startsWith("time:"),
    );
    expect(badMarried).toBeUndefined();
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
    const entities = ex(fixture);
    const rels = extractRelationships(fixture, entities, { minConfidence: 0.3 });
    for (const r of rels) {
      expect(r.confidence).toBeGreaterThanOrEqual(0.3);
      expect(r.confidence).toBeLessThanOrEqual(0.9);
    }
  });
});
