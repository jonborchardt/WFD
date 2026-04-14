import { describe, it, expect, beforeEach } from "vitest";
import { loadGazetteer, resetGazetteerCache } from "../src/nlp/gazetteer.ts";

describe("gazetteer loader", () => {
  beforeEach(() => resetGazetteerCache());

  it("merges data/gazetteer files with defaults", () => {
    const g = loadGazetteer("data");
    // Default seed term.
    expect(g.organization.some((x) => /OpenAI/i.test(x))).toBe(true);
    // Added via data/gazetteer/organization.txt.
    expect(g.organization.some((x) => /Federal Reserve/i.test(x))).toBe(true);
    expect(g.location.some((x) => /Wuhan/i.test(x))).toBe(true);
  });

  it("falls back to defaults when directory is missing", () => {
    const g = loadGazetteer("data/does-not-exist");
    expect(g.organization.length).toBeGreaterThan(0);
    expect(g.location.length).toBeGreaterThan(0);
  });
});
