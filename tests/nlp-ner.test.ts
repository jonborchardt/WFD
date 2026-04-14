import { describe, it, expect, beforeEach } from "vitest";
import {
  runNer,
  chunkText,
  __setNerPipelineForTests,
} from "../src/nlp/ner.ts";

describe("ner module", () => {
  beforeEach(() => __setNerPipelineForTests(null));

  it("returns [] when pipeline is unavailable", async () => {
    __setNerPipelineForTests(null);
    const out = await runNer("Biden met Merkel in Berlin.");
    expect(out).toEqual([]);
  });

  it("aggregates subword B-/I- tags and locates char offsets in text", async () => {
    // Simulate the raw subword stream that transformers.js actually emits:
    // null start/end, B-/I- tags, and "##" subword continuations.
    const fake = async () => [
      { entity: "B-PER", word: "B", index: 1, start: null, end: null, score: 0.99 },
      { entity: "B-PER", word: "##iden", index: 2, start: null, end: null, score: 0.99 },
      { entity: "B-PER", word: "Me", index: 4, start: null, end: null, score: 0.99 },
      { entity: "B-PER", word: "##rkel", index: 5, start: null, end: null, score: 0.99 },
      { entity: "B-LOC", word: "Berlin", index: 7, start: null, end: null, score: 0.99 },
      { entity: "B-ORG", word: "NASA", index: 10, start: null, end: null, score: 0.99 },
    ];
    __setNerPipelineForTests(fake);
    const text = "Biden met Merkel in Berlin. NASA confirmed the findings.";
    const out = await runNer(text);
    const byType = (t: string) => out.filter((m) => m.type === t).map((m) => m.surface);
    expect(byType("person")).toEqual(expect.arrayContaining(["Biden", "Merkel"]));
    expect(byType("location")).toContain("Berlin");
    expect(byType("organization")).toContain("NASA");
    for (const m of out) {
      expect(text.slice(m.start, m.end)).toBe(m.surface);
    }
  });

  it("drops entities below the score threshold", async () => {
    const fake = async () => [
      { entity: "B-PER", word: "Someone", index: 1, start: null, end: null, score: 0.5 },
      { entity: "B-PER", word: "Biden", index: 3, start: null, end: null, score: 0.99 },
    ];
    __setNerPipelineForTests(fake);
    const out = await runNer("Someone told Biden hello.");
    expect(out.length).toBe(1);
    expect(out[0].surface).toBe("Biden");
  });

  it("chunks at sentence boundaries and never exceeds the cap", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200);
      expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    }
  });
});
