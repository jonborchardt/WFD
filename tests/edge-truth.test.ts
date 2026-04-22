import { describe, it, expect } from "vitest";
import { computeEdgeTruth } from "../src/truth/edge-truth.js";
import type { ClaimsIndexEntry } from "../src/truth/claim-indexes.js";

function entry(partial: Partial<ClaimsIndexEntry> & Pick<ClaimsIndexEntry, "id" | "videoId">): ClaimsIndexEntry {
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
    tags: partial.tags ?? [],
  };
}

describe("computeEdgeTruth", () => {
  it("averages citing claims' derivedTruth (falling back to directTruth)", () => {
    const claims = [
      entry({ id: "v1:c1", videoId: "v1", relationships: ["r1"], derivedTruth: 0.8 }),
      entry({ id: "v1:c2", videoId: "v1", relationships: ["r1"], directTruth: 0.4 }),
      entry({ id: "v1:c3", videoId: "v1", relationships: [] }),  // no rel
      entry({ id: "v1:c4", videoId: "v1", relationships: ["r1"] }),  // no truth
    ];
    const map = new Map([
      ["v1", new Map([["r1", "person:a|knows|person:b"]])],
    ]);
    const out = computeEdgeTruth(claims, map);
    expect(out.edgeCount).toBe(1);
    const e = out.edges["person:a|knows|person:b"];
    expect(e.claimCount).toBe(2);
    expect(e.truth).toBeCloseTo((0.8 + 0.4) / 2);
    expect(e.supportingClaimIds).toEqual(["v1:c1", "v1:c2"]);
  });

  it("skips edges with zero eligible citations", () => {
    const claims = [entry({ id: "v:c1", videoId: "v", relationships: ["r1"] })];
    const map = new Map([["v", new Map([["r1", "a|p|b"]])]]);
    const out = computeEdgeTruth(claims, map);
    expect(out.edgeCount).toBe(0);
  });

  it("drops rel ids without a per-video mapping entry", () => {
    const claims = [
      entry({ id: "v:c1", videoId: "v", relationships: ["r-missing"], derivedTruth: 0.7 }),
    ];
    const out = computeEdgeTruth(claims, new Map([["v", new Map()]]));
    expect(out.edgeCount).toBe(0);
  });
});
