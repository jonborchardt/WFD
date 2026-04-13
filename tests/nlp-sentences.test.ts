import { describe, it, expect } from "vitest";
import { segmentSentences } from "../src/nlp/sentences.ts";

describe("sentence segmentation", () => {
  it("splits on terminators", () => {
    const text = "Biden met Merkel. She said hello. The end.";
    const spans = segmentSentences(text);
    expect(spans.length).toBe(3);
    for (const s of spans) {
      expect(s.end).toBeGreaterThan(s.start);
      expect(text.slice(s.start, s.end).length).toBeGreaterThan(0);
    }
  });

  it("does not split on abbreviations like Mr.", () => {
    const text = "Mr. Smith met Dr. Jones. They talked.";
    const spans = segmentSentences(text);
    expect(spans.length).toBe(2);
    expect(text.slice(spans[0].start, spans[0].end)).toContain("Smith");
    expect(text.slice(spans[0].start, spans[0].end)).toContain("Jones");
  });
});
