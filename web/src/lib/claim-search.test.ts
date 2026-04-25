import { describe, it, expect } from "vitest";
import { matchesTopic } from "./claim-search";
import type { ClaimsIndexEntry } from "../types";

function entry(
  partial: Partial<ClaimsIndexEntry> & Pick<ClaimsIndexEntry, "id" | "videoId">,
): ClaimsIndexEntry {
  return {
    id: partial.id,
    videoId: partial.videoId,
    kind: partial.kind ?? "empirical",
    text: partial.text ?? "t",
    hostStance: partial.hostStance ?? null,
    entities: partial.entities ?? [],
    relationships: partial.relationships ?? [],
    dependencies: partial.dependencies ?? [],
    confidence: partial.confidence ?? 0.8,
    directTruth: partial.directTruth ?? null,
    derivedTruth: partial.derivedTruth ?? null,
    truthSource: partial.truthSource ?? "uncalibrated",
  };
}

describe("matchesTopic", () => {
  it("empty query matches everything", () => {
    expect(matchesTopic(entry({ id: "a", videoId: "v" }), "")).toBe(true);
    expect(matchesTopic(entry({ id: "a", videoId: "v" }), "   ")).toBe(true);
  });

  it("matches entity canonicals", () => {
    const c = entry({
      id: "a",
      videoId: "v",
      entities: ["organization:cia", "location:area 51"],
    });
    expect(matchesTopic(c, "cia")).toBe(true);
    expect(matchesTopic(c, "area 51")).toBe(true);
    expect(matchesTopic(c, "CIA")).toBe(true);
    expect(matchesTopic(c, "mars")).toBe(false);
  });

  it("matches the entity label prefix too", () => {
    const c = entry({
      id: "a",
      videoId: "v",
      entities: ["organization:cia"],
    });
    expect(matchesTopic(c, "organization")).toBe(true);
  });

  it("matches the claim kind", () => {
    const c = entry({ id: "a", videoId: "v", kind: "speculative" });
    expect(matchesTopic(c, "spec")).toBe(true);
  });

  it("no match when nothing contains the query", () => {
    const c = entry({
      id: "a",
      videoId: "v",
      entities: ["organization:cia"],
      kind: "empirical",
    });
    expect(matchesTopic(c, "dinosaur")).toBe(false);
  });
});
