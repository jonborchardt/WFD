import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addClaimTruthOverride,
  removeClaimTruthOverride,
  addClaimDeletion,
  removeClaimDeletion,
  setClaimFieldOverride,
  removeClaimFieldOverride,
  addContradictionDismissal,
  removeContradictionDismissal,
  addCustomContradiction,
  removeCustomContradiction,
  readAliasesFile,
} from "../src/graph/aliases-schema.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aliases-claim-")); });
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function load(dataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir, "aliases.json"), "utf8"));
}

describe("aliases-schema claim sections", () => {
  it("round-trips a truth override and its removal", () => {
    addClaimTruthOverride(dir, "v:c1", 0.25, "retracted");
    const a = readAliasesFile(dir);
    expect(a.claimTruthOverrides).toEqual([
      { claimId: "v:c1", directTruth: 0.25, rationale: "retracted" },
    ]);
    removeClaimTruthOverride(dir, "v:c1");
    expect(readAliasesFile(dir).claimTruthOverrides).toEqual([]);
  });

  it("rejects directTruth out of [0,1]", () => {
    expect(() => addClaimTruthOverride(dir, "v:c1", 1.2)).toThrow();
  });

  it("merges field overrides across successive writes", () => {
    setClaimFieldOverride(dir, "v:c1", { text: "rewritten" });
    setClaimFieldOverride(dir, "v:c1", { rationale: "because" });
    const a = readAliasesFile(dir);
    expect(a.claimFieldOverrides).toHaveLength(1);
    const e = a.claimFieldOverrides[0];
    expect(e.text).toBe("rewritten");
    expect(e.rationale).toBe("because");
  });

  it("empty override is dropped entirely", () => {
    setClaimFieldOverride(dir, "v:c1", { text: "hi" });
    setClaimFieldOverride(dir, "v:c1", { text: "" });
    expect(readAliasesFile(dir).claimFieldOverrides).toEqual([]);
  });

  it("claim deletion is idempotent", () => {
    addClaimDeletion(dir, "v:c1");
    addClaimDeletion(dir, "v:c1");
    expect(readAliasesFile(dir).claimDeletions).toEqual([{ claimId: "v:c1" }]);
    removeClaimDeletion(dir, "v:c1");
    expect(readAliasesFile(dir).claimDeletions).toEqual([]);
  });

  it("contradiction dismissal normalizes pair order and is idempotent", () => {
    addContradictionDismissal(dir, "v2:x", "v1:y", "different contexts");
    const a = readAliasesFile(dir);
    expect(a.contradictionDismissals).toEqual([
      { a: "v1:y", b: "v2:x", reason: "different contexts" },
    ]);
    // adding again replaces rather than duplicates
    addContradictionDismissal(dir, "v1:y", "v2:x", "updated reason");
    expect(readAliasesFile(dir).contradictionDismissals).toEqual([
      { a: "v1:y", b: "v2:x", reason: "updated reason" },
    ]);
    removeContradictionDismissal(dir, "v2:x", "v1:y");
    expect(readAliasesFile(dir).contradictionDismissals).toEqual([]);
  });

  it("custom contradictions round-trip with shared entities", () => {
    addCustomContradiction(dir, "v2:x", "v1:y", "operator note", [
      "organization:cia",
      "location:area 51",
    ]);
    const a = readAliasesFile(dir);
    expect(a.customContradictions[0].a).toBe("v1:y");
    expect(a.customContradictions[0].summary).toBe("operator note");
    expect(a.customContradictions[0].sharedEntities).toEqual([
      "location:area 51",
      "organization:cia",
    ]);
    removeCustomContradiction(dir, "v1:y", "v2:x");
    expect(readAliasesFile(dir).customContradictions).toEqual([]);
  });

  it("file-level schemaVersion stays 2 through claim-section writes", () => {
    addClaimTruthOverride(dir, "v:c1", 0.5);
    const raw = load(dir);
    expect(raw.schemaVersion).toBe(2);
  });

  it("remove-field clears the whole entry", () => {
    setClaimFieldOverride(dir, "v:c1", { text: "x", tags: ["a"] });
    removeClaimFieldOverride(dir, "v:c1");
    expect(readAliasesFile(dir).claimFieldOverrides).toEqual([]);
  });
});
