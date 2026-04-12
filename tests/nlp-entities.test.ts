import { describe, it, expect } from "vitest";
import { extract, flatten } from "../src/nlp/entities.ts";

const fixture = {
  videoId: "fix001",
  cues: [
    { start: 0, duration: 3, text: "President Biden met with Angela Merkel in Berlin." },
    { start: 3, duration: 2, text: "They discussed the vaccine rollout in 2021." },
    { start: 5, duration: 2, text: "NASA confirmed the findings on 2021-06-15." },
  ],
};

describe("entity extraction", () => {
  it("extracts people, locations, orgs, things, times", () => {
    const entities = extract(fixture);
    const types = entities.map((e) => e.type);
    expect(types).toContain("person");
    expect(types).toContain("location");
    expect(types).toContain("organization");
    expect(types).toContain("thing");
    expect(types).toContain("time");
    const canonicals = entities.map((e) => e.canonical.toLowerCase());
    expect(canonicals).toContain("angela merkel");
    expect(canonicals).toContain("berlin");
    expect(canonicals).toContain("nasa");
    expect(canonicals).toContain("vaccine");
    expect(canonicals).toContain("2021");
  });

  it("dedupes mentions under a single canonical entity", () => {
    const duped = {
      videoId: "dup",
      cues: [
        { start: 0, duration: 1, text: "Angela Merkel spoke." },
        { start: 1, duration: 1, text: "Later, Angela Merkel spoke again." },
      ],
    };
    const entities = extract(duped);
    const merkel = entities.find((e) => e.canonical === "Angela Merkel");
    expect(merkel).toBeTruthy();
    expect(merkel!.mentions.length).toBe(2);
  });

  it("spans point back to the right time window", () => {
    const entities = extract(fixture);
    const nasa = entities.find((e) => e.canonical === "NASA");
    expect(nasa).toBeTruthy();
    expect(nasa!.mentions[0].timeStart).toBeGreaterThanOrEqual(5);
    expect(nasa!.mentions[0].timeEnd).toBeLessThanOrEqual(8);
  });

  it("flatten produces consistent cue offsets", () => {
    const { text, cueStarts } = flatten(fixture);
    expect(cueStarts.length).toBe(fixture.cues.length);
    expect(text.slice(cueStarts[1], cueStarts[1] + 3)).toBe(fixture.cues[1].text.slice(0, 3));
  });
});
