import { describe, it, expect } from "vitest";
import {
  emptyOverlay,
  mergeNlpWithOverlay,
  NlpOverlay,
  PersistedNlp,
} from "../src/nlp/persist.js";
import { Entity, Relationship, TranscriptSpan } from "../src/shared/types.js";

function span(charStart = 0): TranscriptSpan {
  return {
    transcriptId: "v1",
    charStart,
    charEnd: charStart + 4,
    timeStart: 0,
    timeEnd: 1,
  };
}

function ent(id: string, canonical: string): Entity {
  return { id, type: "person", canonical, aliases: [], mentions: [span()] };
}

function rel(id: string, subjectId: string, objectId: string): Relationship {
  return {
    id,
    subjectId,
    predicate: "knows",
    objectId,
    evidence: span(),
    confidence: 1,
    provenance: "nlp",
  };
}

describe("mergeNlpWithOverlay", () => {
  const base: PersistedNlp = {
    entities: [ent("person:alice", "Alice"), ent("person:bob", "Bob")],
    relationships: [rel("r1", "person:alice", "person:bob")],
  };

  it("returns the base unchanged when overlay is null", () => {
    expect(mergeNlpWithOverlay(base, null)).toEqual(base);
  });

  it("adds entities and relationships from the overlay", () => {
    const overlay: NlpOverlay = {
      ...emptyOverlay(),
      addEntities: [ent("person:carol", "Carol")],
      addRelationships: [rel("r2", "person:alice", "person:carol")],
    };
    const merged = mergeNlpWithOverlay(base, overlay);
    expect(merged.entities.map((e) => e.id).sort()).toEqual([
      "person:alice",
      "person:bob",
      "person:carol",
    ]);
    expect(merged.relationships.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("removes entities and relationships matching overlay ids", () => {
    const overlay: NlpOverlay = {
      ...emptyOverlay(),
      removeEntities: [{ id: "person:bob" }],
      removeRelationships: [{ id: "r1" }],
    };
    const merged = mergeNlpWithOverlay(base, overlay);
    expect(merged.entities.map((e) => e.id)).toEqual(["person:alice"]);
    expect(merged.relationships).toEqual([]);
  });

  it("overlay adds override auto entries with the same id", () => {
    const overlay: NlpOverlay = {
      ...emptyOverlay(),
      addEntities: [
        {
          id: "person:alice",
          type: "person",
          canonical: "Alice Edited",
          aliases: ["A."],
          mentions: [],
        },
      ],
    };
    const merged = mergeNlpWithOverlay(base, overlay);
    const alice = merged.entities.find((e) => e.id === "person:alice");
    expect(alice?.canonical).toBe("Alice Edited");
    expect(alice?.aliases).toContain("A.");
  });

  it("a removed id is still removed even when the overlay adds it back", () => {
    const overlay: NlpOverlay = {
      ...emptyOverlay(),
      addEntities: [ent("person:bob", "Bob Restored")],
      removeEntities: [{ id: "person:bob" }],
    };
    const merged = mergeNlpWithOverlay(base, overlay);
    expect(merged.entities.find((e) => e.id === "person:bob")).toBeUndefined();
  });
});
