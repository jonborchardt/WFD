import { describe, it, expect } from "vitest";
import { buildClaimGraph, resolveSeed } from "./claim-graph-build";
import type { ClaimsIndexEntry, ClaimContradiction, DependencyGraphFile } from "../types";

function entry(
  partial: Partial<ClaimsIndexEntry> & Pick<ClaimsIndexEntry, "id" | "videoId">,
): ClaimsIndexEntry {
  return {
    id: partial.id,
    videoId: partial.videoId,
    kind: partial.kind ?? "empirical",
    text: partial.text ?? partial.id,
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

const baseDeps: DependencyGraphFile = { generatedAt: "", edges: [], edgeCount: 0 };

describe("claim-graph-build", () => {
  it("resolveSeed(video) returns all claims in that video", () => {
    const index = [
      entry({ id: "v1:c1", videoId: "v1" }),
      entry({ id: "v1:c2", videoId: "v1" }),
      entry({ id: "v2:c1", videoId: "v2" }),
    ];
    const seeds = resolveSeed(
      { index, deps: baseDeps, contradictions: [] },
      { kind: "video", videoId: "v1" },
    );
    expect(seeds.sort()).toEqual(["v1:c1", "v1:c2"]);
  });

  it("resolveSeed(entity) returns claims containing that entity key", () => {
    const index = [
      entry({ id: "v1:c1", videoId: "v1", entities: ["organization:cia"] }),
      entry({ id: "v1:c2", videoId: "v1", entities: ["location:moon"] }),
    ];
    const seeds = resolveSeed(
      { index, deps: baseDeps, contradictions: [] },
      { kind: "entity", entityKey: "organization:cia" },
    );
    expect(seeds).toEqual(["v1:c1"]);
  });

  it("expands 1 hop via deps, contradictions, and shared-evidence", () => {
    const index = [
      entry({ id: "v1:c1", videoId: "v1", relationships: ["r1"] }),
      entry({ id: "v1:c2", videoId: "v1" }),  // dep target
      entry({ id: "v2:c1", videoId: "v2" }),  // contradiction peer
      entry({ id: "v3:c1", videoId: "v3", relationships: ["r1"] }),  // shares evidence
      entry({ id: "v4:c1", videoId: "v4" }),  // unrelated, should NOT appear
    ];
    const deps: DependencyGraphFile = {
      generatedAt: "",
      edges: [{ from: "v1:c1", to: "v1:c2", kind: "supports", rationale: null }],
      edgeCount: 1,
    };
    const cx: ClaimContradiction[] = [
      { kind: "pair", left: "v1:c1", right: "v2:c1", summary: "x" },
    ];
    const g = buildClaimGraph({ index, deps, contradictions: cx }, ["v1:c1"]);
    expect([...g.nodes.keys()].sort()).toEqual(["v1:c1", "v1:c2", "v2:c1", "v3:c1"]);

    // seed node at distance 0, neighbors at distance 1
    expect(g.nodes.get("v1:c1")!.distance).toBe(0);
    expect(g.nodes.get("v3:c1")!.distance).toBe(1);

    // edges: one supports, one contradiction, one shared-evidence
    const kinds = [...g.edges.values()].map((e) => e.kind).sort();
    expect(kinds).toEqual(["contradiction", "shared-evidence", "supports"]);
  });

  it("does not duplicate nodes when a claim is reachable by multiple paths", () => {
    const index = [
      entry({ id: "v:a", videoId: "v", relationships: ["r1"] }),
      entry({ id: "v:b", videoId: "v", relationships: ["r1"] }),
    ];
    const deps: DependencyGraphFile = {
      generatedAt: "",
      edges: [{ from: "v:a", to: "v:b", kind: "supports", rationale: null }],
      edgeCount: 1,
    };
    const g = buildClaimGraph({ index, deps, contradictions: [] }, ["v:a"]);
    expect(g.nodes.size).toBe(2);
    // Both a supports edge AND a shared-evidence edge should land — one
    // per (from→to, kind) pair.
    expect(g.edges.size).toBe(2);
  });

  it("seed's self-referential shared-evidence edges are skipped", () => {
    const index = [
      entry({ id: "v:a", videoId: "v", relationships: ["r1"] }),
    ];
    const g = buildClaimGraph({ index, deps: baseDeps, contradictions: [] }, ["v:a"]);
    // No other claim cites r1; no shared-evidence edge to self.
    expect(g.edges.size).toBe(0);
  });
});
