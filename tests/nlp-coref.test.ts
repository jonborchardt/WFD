import { describe, it, expect } from "vitest";
import { extract } from "../src/nlp/entities.ts";
import { extractRelationships } from "../src/nlp/relationships.ts";

describe("coreference resolution", () => {
  it("resolves last-name mentions to the full-name entity", () => {
    const t = {
      videoId: "cf1",
      cues: [
        { start: 0, duration: 2, text: "Angela Merkel addressed the press." },
        { start: 2, duration: 2, text: "Later, Merkel left the room." },
      ],
    };
    const entities = extract(t);
    const persons = entities.filter((e) => e.type === "person");
    expect(persons.length).toBe(1);
    const merkel = persons[0];
    expect(merkel.canonical).toBe("Angela Merkel");
    expect(merkel.mentions.length).toBe(2);
    expect(merkel.aliases).toContain("Merkel");
  });

  it("binds an unambiguous pronoun to the preceding person", () => {
    const t = {
      videoId: "cf2",
      cues: [
        { start: 0, duration: 2, text: "Angela Merkel met the delegation." },
        { start: 2, duration: 2, text: "She said the talks went well." },
      ],
    };
    const entities = extract(t);
    const merkel = entities.find((e) => e.canonical === "Angela Merkel")!;
    expect(merkel).toBeTruthy();
    expect(merkel.mentions.length).toBeGreaterThanOrEqual(2);
    expect(merkel.aliases.map((a) => a.toLowerCase())).toContain("she");
  });

  it("refuses to bind a pronoun when the window has multiple persons", () => {
    const t = {
      videoId: "cf3",
      cues: [
        { start: 0, duration: 2, text: "Angela Merkel met Emmanuel Macron." },
        { start: 2, duration: 2, text: "He said the talks went well." },
      ],
    };
    const entities = extract(t);
    const aliases = entities
      .filter((e) => e.type === "person")
      .flatMap((e) => e.aliases.map((a) => a.toLowerCase()));
    expect(aliases).not.toContain("he");
  });

  it("lets pronoun-bound mentions feed the relationship extractor", () => {
    const t = {
      videoId: "cf4",
      cues: [
        { start: 0, duration: 2, text: "Angela Merkel arrived in Berlin." },
        { start: 2, duration: 2, text: "She said the vaccine rollout was successful." },
      ],
    };
    const entities = extract(t);
    const rels = extractRelationships(t, entities);
    const saidVaccine = rels.find(
      (r) =>
        r.predicate === "said" &&
        r.subjectId.includes("angela merkel") &&
        r.objectId.includes("vaccine"),
    );
    expect(saidVaccine).toBeTruthy();
  });

  it("coref: false disables the pass", () => {
    const t = {
      videoId: "cf5",
      cues: [
        { start: 0, duration: 2, text: "Angela Merkel addressed the press." },
        { start: 2, duration: 2, text: "Later, Merkel left the room." },
      ],
    };
    const entities = extract(t, { coref: false });
    const merkel = entities.find((e) => e.canonical === "Angela Merkel")!;
    expect(merkel.mentions.length).toBe(1);
  });
});
