import { describe, it, expect } from "vitest";
import { runCounterfactual } from "./counterfactual";
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
    tags: partial.tags ?? [],
  };
}

describe("runCounterfactual", () => {
  it("moves a supporting dependent toward the pinned value", () => {
    const claims = [
      entry({ id: "c1", videoId: "v", directTruth: 0.9,
        dependencies: [{ target: "c2", kind: "supports" }] }),
      entry({ id: "c2", videoId: "v", directTruth: 0.9 }),
    ];
    const r = runCounterfactual(claims, "c1", 0.0);
    const c2 = r.rows.find((row) => row.id === "c2");
    expect(c2).toBeDefined();
    expect(c2!.delta).toBeLessThan(0);
  });

  it("does not include the pinned claim itself in the rows", () => {
    const claims = [entry({ id: "c1", videoId: "v", directTruth: 0.9 })];
    const r = runCounterfactual(claims, "c1", 0.1);
    expect(r.rows.find((row) => row.id === "c1")).toBeUndefined();
  });

  it("disconnected claim with no-op pin produces empty rows and zero counts", () => {
    const claims = [
      entry({ id: "c1", videoId: "v", directTruth: 0.5 }),
      entry({ id: "c2", videoId: "v", directTruth: 0.9 }),  // disconnected
    ];
    const r = runCounterfactual(claims, "c1", 0.5);
    expect(r.rows).toHaveLength(0);
    expect(r.visibleCount).toBe(0);
    expect(r.smallShiftCount).toBe(0);
  });

  it("contradicts edge inverts the pin direction for the dependent", () => {
    const claims = [
      entry({ id: "c1", videoId: "v", directTruth: 0.5,
        dependencies: [{ target: "c2", kind: "contradicts" }] }),
      entry({ id: "c2", videoId: "v", directTruth: 0.5 }),
    ];
    const t = runCounterfactual(claims, "c1", 1.0);
    const f = runCounterfactual(claims, "c1", 0.0);
    const c2True = t.rows.find((row) => row.id === "c2");
    const c2False = f.rows.find((row) => row.id === "c2");
    expect(c2True && c2False).toBeTruthy();
    expect(c2True!.counterfactual).toBeLessThan(c2False!.counterfactual);
  });

  it("flags claims that shift below DELTA_VISIBLE as smallShift (not rows)", () => {
    // Dilute c1's influence on c2 with many other supporters so a single
    // pin produces only a tiny delta.
    const supporters = Array.from({ length: 10 }, (_, i) =>
      entry({
        id: `s${i}`, videoId: "v",
        directTruth: 0.9,
        confidence: 0.8,
        dependencies: [{ target: "c2", kind: "supports" }],
      }),
    );
    const claims = [
      entry({ id: "c1", videoId: "v", directTruth: 0.5, confidence: 0.1,
        dependencies: [{ target: "c2", kind: "supports" }] }),
      entry({ id: "c2", videoId: "v", directTruth: 0.9 }),
      ...supporters,
    ];
    const r = runCounterfactual(claims, "c1", 0.0);
    // c2 did shift slightly but not enough to render prominently.
    expect(r.rows.find((row) => row.id === "c2")).toBeUndefined();
    expect(r.smallShiftCount).toBeGreaterThanOrEqual(1);
  });

  it("appeared: claim gains a derivedTruth under the pin that it lacked at baseline", () => {
    // c2 has no directTruth and no incoming at baseline. Pinning c1
    // (which supports c2) gives c2 a value only in the counterfactual.
    const claims = [
      entry({ id: "c1", videoId: "v",
        dependencies: [{ target: "c2", kind: "supports" }] }),
      entry({ id: "c2", videoId: "v" }),
    ];
    const r = runCounterfactual(claims, "c1", 1.0);
    const c2 = r.rows.find((row) => row.id === "c2");
    expect(c2).toBeDefined();
    expect(c2!.appeared).toBe(true);
    expect(c2!.baseline).toBeNull();
  });
});
