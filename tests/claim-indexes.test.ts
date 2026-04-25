import { describe, it, expect } from "vitest";
import { buildClaimIndexes } from "../src/truth/claim-indexes.js";
import type { Claim } from "../src/claims/types.js";

function claim(partial: Partial<Claim> & Pick<Claim, "id" | "videoId" | "text">): Claim {
  return {
    id: partial.id,
    videoId: partial.videoId,
    text: partial.text,
    kind: partial.kind ?? "empirical",
    entities: partial.entities ?? [],
    relationships: partial.relationships ?? [],
    evidence: partial.evidence ?? [],
    confidence: partial.confidence ?? 0.8,
    directTruth: partial.directTruth,
    rationale: partial.rationale ?? "test",
    dependencies: partial.dependencies,
    hostStance: partial.hostStance,
    inVerdictSection: partial.inVerdictSection,
    tags: partial.tags,
  };
}

describe("buildClaimIndexes", () => {
  it("propagates direct truth and tags source on each entry", () => {
    const claims = [
      claim({ id: "v:c1", videoId: "v", text: "root", directTruth: 0.9 }),
      claim({
        id: "v:c2",
        videoId: "v",
        text: "depends on root",
        dependencies: [{ target: "v:c1", kind: "supports" }],
      }),
    ];
    const r = buildClaimIndexes({ claims, videoCount: 1 });
    const byId = new Map(r.index.claims.map((c) => [c.id, c]));
    expect(byId.get("v:c1")!.truthSource).toBe("direct");
    // c2 has no directTruth and no incoming supports edge (c1→c2 would
    // be c1 supports c2, but we defined c2 depends-on c1) → uncalibrated.
    expect(byId.get("v:c2")!.directTruth).toBeNull();
  });

  it("applies truth overrides as pinned anchors", () => {
    const claims = [claim({ id: "v:c1", videoId: "v", text: "x", directTruth: 0.9 })];
    const r = buildClaimIndexes({
      claims,
      videoCount: 1,
      truthOverrides: [{ claimId: "v:c1", directTruth: 0.2, rationale: "retracted" }],
    });
    const e = r.index.claims[0];
    expect(e.directTruth).toBe(0.2);
    expect(e.truthSource).toBe("override");
    expect(e.overrideRationale).toBe("retracted");
  });

  it("drops deleted claims and their incoming dep edges", () => {
    const claims = [
      claim({ id: "v:c1", videoId: "v", text: "root" }),
      claim({
        id: "v:c2",
        videoId: "v",
        text: "supports root",
        dependencies: [{ target: "v:c1", kind: "supports" }],
      }),
    ];
    const r = buildClaimIndexes({
      claims,
      videoCount: 1,
      deletedClaimIds: new Set(["v:c1"]),
    });
    expect(r.index.claims.find((c) => c.id === "v:c1")).toBeUndefined();
    // dep edge pointing at the deleted claim is filtered out of the graph.
    expect(r.dependencyGraph.edges.find((e) => e.to === "v:c1")).toBeUndefined();
  });

  it("field overrides propagate into the index entry and reasoning", () => {
    const claims = [
      claim({ id: "v:c1", videoId: "v", text: "orig text", kind: "empirical" }),
    ];
    const r = buildClaimIndexes({
      claims,
      videoCount: 1,
      fieldOverrides: [{ claimId: "v:c1", text: "new text", rationale: "fixed" }],
    });
    const e = r.index.claims[0];
    expect(e.text).toBe("new text");
    expect(e.fieldOverrides).toContain("text");
    expect(e.fieldOverrides).toContain("rationale");
    expect(e.fieldOverrides).not.toContain("kind");
  });

  it("field overrides list filters out undefined fields even if the loader materialized them", () => {
    // Simulates what stages.ts does when it maps aliases entries: every
    // key exists on the object even if its value is undefined.
    const claims = [claim({ id: "v:c1", videoId: "v", text: "orig" })];
    const r = buildClaimIndexes({
      claims,
      videoCount: 1,
      fieldOverrides: [{
        claimId: "v:c1",
        text: "new",
        kind: undefined,
        hostStance: undefined,
        rationale: undefined,
      }],
    });
    expect(r.index.claims[0].fieldOverrides).toEqual(["text"]);
  });

  it("dismissed contradictions drop out; custom ones surface as kind: manual", () => {
    // Use the pair detector — in-video `contradicts` edge, both truths ≥ 0.5.
    const claims = [
      claim({
        id: "v:c1",
        videoId: "v",
        text: "X is so",
        directTruth: 0.9,
        dependencies: [{ target: "v:c2", kind: "contradicts" }],
      }),
      claim({ id: "v:c2", videoId: "v", text: "X is not so", directTruth: 0.8 }),
    ];
    const r1 = buildClaimIndexes({ claims, videoCount: 1 });
    expect(r1.contradictions.total).toBeGreaterThan(0);

    const r2 = buildClaimIndexes({
      claims,
      videoCount: 1,
      dismissedContradictions: [{ a: "v:c1", b: "v:c2" }],
    });
    expect(r2.contradictions.contradictions.find((c) => c.kind === "pair")).toBeUndefined();

    const r3 = buildClaimIndexes({
      claims: [
        claim({ id: "v1:c9", videoId: "v1", text: "x" }),
        claim({ id: "v2:c9", videoId: "v2", text: "y" }),
      ],
      videoCount: 2,
      customContradictions: [{ a: "v1:c9", b: "v2:c9", summary: "operator flag" }],
    });
    expect(r3.contradictions.contradictions.find((c) => c.kind === "manual")).toBeDefined();
  });

  it("cross-video matchReason tags `strong-overlap` when jaccard is weak", () => {
    // Two claims in different videos with many shared entities but
    // unrelated text — they match via the strong-overlap path.
    const claims = [
      claim({
        id: "v1:c1", videoId: "v1",
        text: "foo bar baz",
        directTruth: 0.9,
        hostStance: "asserts",
        entities: ["organization:cia", "location:mars", "event:apollo"],
      }),
      claim({
        id: "v2:c1", videoId: "v2",
        text: "qux zap wobble",
        directTruth: 0.1,
        hostStance: "denies",
        entities: ["organization:cia", "location:mars", "event:apollo"],
      }),
    ];
    const r = buildClaimIndexes({ claims, videoCount: 2 });
    const cv = r.contradictions.contradictions.find((c) => c.kind === "cross-video");
    expect(cv).toBeDefined();
    expect(cv!.matchReason).toBe("strong-overlap");
    expect(cv!.sharedEntities?.length).toBe(3);
  });

  it("near-duplicate claims with just a truth-score gap are NOT flagged (AI scoring jitter, not contradiction)", () => {
    // Real-corpus regression: two claims listing the same historical
    // figures (Kepler, Copernicus, Pasteur, Mendel, Tesla), same
    // argument, both host-asserts, truth scored 0.30 in one video and
    // 0.70 in another. High Jaccard + both assert → scoring jitter on
    // a duplicated claim, not a disagreement.
    const text =
      "mainstream science dismisses as pseudoscience ideas like kepler copernicus pasteur mendel tesla that later turned out correct";
    const claims = [
      claim({
        id: "v1:c1", videoId: "v1",
        text,
        directTruth: 0.3,
        hostStance: "asserts",
        entities: ["person:kepler", "person:copernicus", "person:pasteur", "person:mendel", "person:tesla"],
      }),
      claim({
        id: "v2:c1", videoId: "v2",
        text,
        directTruth: 0.7,
        hostStance: "asserts",
        entities: ["person:kepler", "person:copernicus", "person:pasteur", "person:mendel", "person:tesla"],
      }),
    ];
    const r = buildClaimIndexes({ claims, videoCount: 2 });
    const cv = r.contradictions.contradictions.filter((c) => c.kind === "cross-video");
    expect(cv).toHaveLength(0);
  });

  it("near-duplicate claims with explicit asserts vs denies ARE flagged", () => {
    // Same high-Jaccard texts but opposing host stance — this is a real
    // conflict and should still surface via the jaccard path.
    const text = "aliens built the pyramids in ancient egypt";
    const claims = [
      claim({
        id: "v1:c1", videoId: "v1",
        text,
        directTruth: 0.9,
        hostStance: "asserts",
        entities: ["person:aliens", "facility:pyramids", "location:egypt"],
      }),
      claim({
        id: "v2:c1", videoId: "v2",
        text,
        directTruth: 0.1,
        hostStance: "denies",
        entities: ["person:aliens", "facility:pyramids", "location:egypt"],
      }),
    ];
    const r = buildClaimIndexes({ claims, videoCount: 2 });
    const cv = r.contradictions.contradictions.filter((c) => c.kind === "cross-video");
    expect(cv).toHaveLength(1);
  });

  it("strong-overlap path rejects matches when both hostStance are 'asserts' (truth gap alone is not enough)", () => {
    // Regression test for the real-corpus noise bug: two CIA-adjacent
    // claims from different videos with unrelated topics, both host-
    // asserted, with a large truth gap. Under the softened truth-gap
    // rule these used to match and produce noise like
    //   "Cold War Soviet overstatement" vs "Project Stargate lucid
    //    dream program"
    // with matchReason=strong-overlap. The strong-overlap path now
    // requires explicit asserts-vs-denies opposition.
    const claims = [
      claim({
        id: "v1:c1", videoId: "v1",
        text: "cia overstated soviet strength during cold war",
        directTruth: 0.7,
        hostStance: "asserts",
        entities: ["organization:cia", "location:soviet union", "event:cold war"],
      }),
      claim({
        id: "v2:c1", videoId: "v2",
        text: "cia ran lucid dreaming program for sleeping subjects",
        directTruth: 0.07,
        hostStance: "asserts",
        entities: ["organization:cia", "event:project stargate", "technology:lucid dreaming"],
      }),
    ];
    const r = buildClaimIndexes({ claims, videoCount: 2 });
    const cv = r.contradictions.contradictions.filter((c) => c.kind === "cross-video");
    // No cross-video contradiction: shared entity count is only 1
    // (organization:cia), so strong-overlap doesn't fire; text Jaccard
    // is weak between these two texts, so jaccard path doesn't fire
    // either. Even if 2+ entities matched, without asserts/denies
    // the strong-overlap path would reject.
    expect(cv).toHaveLength(0);
  });
});
