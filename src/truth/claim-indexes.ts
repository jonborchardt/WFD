// Aggregate per-video claim files into corpus-wide reports.
//
// Pure function: no disk I/O, no pipeline context. The `claim-indexes`
// graph stage (src/pipeline/stages.ts) drives the reads/writes; the
// reasoning CLI (src/ai/reasoning/run.mjs) also uses this module.
//
// Inputs:
//   claims      — flat array of Claim records spanning one or more videos
//   overrides   — optional operator-supplied truth anchors from aliases
//                 (Phase 4). Pinned during propagation; dropped claims are
//                 filtered out before any reasoning runs.
//
// Outputs match the three files already written under data/claims/:
//   claims-index.json      — flat list with derivedTruth + truthSource tag
//   dependency-graph.json  — flat edge list for the claim DAG
//   contradictions.json    — pair / broken-presupposition / cross-video

import type { Claim, ClaimId, DependencyKind } from "../claims/types.js";
import { propagateClaims } from "./claim-propagation.js";
import {
  detectClaimContradictions,
  type ClaimContradiction,
} from "./claim-contradictions.js";

export type TruthSource = "direct" | "derived" | "override" | "uncalibrated";

export interface ClaimsIndexEntry {
  id: ClaimId;
  videoId: string;
  kind: Claim["kind"];
  text: string;
  hostStance: Claim["hostStance"] | null;
  entities: string[];
  relationships: string[];
  dependencies: Array<{ target: ClaimId; kind: DependencyKind; rationale: string | null }>;
  confidence: number;
  directTruth: number | null;
  derivedTruth: number | null;
  truthSource: TruthSource;
  overrideRationale?: string;
  inVerdictSection?: boolean;
  tags: string[];
  fieldOverrides?: Array<"text" | "kind" | "hostStance" | "rationale" | "tags">;
}

export interface ClaimsIndexFile {
  generatedAt: string;
  videoCount: number;
  claimCount: number;
  propagation: {
    iterations: number;
    maxDelta: number;
    claimsWithDerived: number;
  };
  claims: ClaimsIndexEntry[];
}

export interface DependencyGraphFile {
  generatedAt: string;
  edges: Array<{
    from: ClaimId;
    to: ClaimId;
    kind: DependencyKind;
    rationale: string | null;
  }>;
  edgeCount: number;
}

export interface ContradictionsFile {
  generatedAt: string;
  total: number;
  byKind: Record<string, number>;
  contradictions: ClaimContradiction[];
}

export interface ClaimOverrideEntry {
  claimId: ClaimId;
  directTruth: number;
  rationale?: string;
}

export interface ClaimFieldOverride {
  claimId: ClaimId;
  text?: string;
  kind?: Claim["kind"];
  hostStance?: Claim["hostStance"];
  rationale?: string;
  tags?: string[];
}

export interface ContradictionDismissal {
  a: ClaimId;
  b: ClaimId;
}

export interface CustomContradictionInput {
  a: ClaimId;
  b: ClaimId;
  summary: string;
  sharedEntities?: string[];
}

export interface BuildClaimIndexesInput {
  claims: Claim[];
  videoCount: number;
  /** Pin these claims' directTruth. Wins over the claim's own directTruth. */
  truthOverrides?: ClaimOverrideEntry[];
  /** Claim ids to drop entirely before any reasoning. */
  deletedClaimIds?: ReadonlySet<ClaimId>;
  /** Text-style admin overrides applied before reasoning. */
  fieldOverrides?: ClaimFieldOverride[];
  /** Contradictions the operator has dismissed (by sorted claim-id pair). */
  dismissedContradictions?: ContradictionDismissal[];
  /** Admin-authored contradictions to surface as `kind: "manual"`. */
  customContradictions?: CustomContradictionInput[];
}

export interface BuildClaimIndexesResult {
  index: ClaimsIndexFile;
  dependencyGraph: DependencyGraphFile;
  contradictions: ContradictionsFile;
}

export function buildClaimIndexes(
  input: BuildClaimIndexesInput,
): BuildClaimIndexesResult {
  const deleted = input.deletedClaimIds ?? new Set<ClaimId>();
  const overrides = input.truthOverrides ?? [];
  const overrideById = new Map<ClaimId, ClaimOverrideEntry>();
  for (const o of overrides) overrideById.set(o.claimId, o);

  const fieldOverrideById = new Map<ClaimId, ClaimFieldOverride>();
  for (const o of input.fieldOverrides ?? []) fieldOverrideById.set(o.claimId, o);

  // Apply field overrides up front so propagation and contradiction
  // detection see the admin-corrected view.
  const claims = input.claims
    .filter((c) => !deleted.has(c.id))
    .map((c) => {
      const fo = fieldOverrideById.get(c.id);
      if (!fo) return c;
      return {
        ...c,
        text: fo.text ?? c.text,
        kind: (fo.kind ?? c.kind) as Claim["kind"],
        hostStance: (fo.hostStance ?? c.hostStance) as Claim["hostStance"],
        rationale: fo.rationale ?? c.rationale,
        tags: fo.tags ?? c.tags,
      };
    });

  const pinned = new Map<ClaimId, number>();
  for (const o of overrides) {
    if (!deleted.has(o.claimId)) pinned.set(o.claimId, o.directTruth);
  }

  const propResult = propagateClaims(claims, { pinned });
  const generatedAt = new Date().toISOString();

  const indexEntries: ClaimsIndexEntry[] = claims.map((c) => {
    const override = overrideById.get(c.id);
    const derived = propResult.derived.get(c.id) ?? null;
    const direct = c.directTruth ?? null;
    let truthSource: TruthSource;
    if (override !== undefined) truthSource = "override";
    else if (derived !== null && derived !== direct) truthSource = "derived";
    else if (direct !== null) truthSource = "direct";
    else truthSource = "uncalibrated";
    const fo = fieldOverrideById.get(c.id);
    let fieldOverrides: ClaimsIndexEntry["fieldOverrides"];
    if (fo) {
      // Only list fields whose override is actually set. Stage-side
      // loaders may materialize undefined keys (e.g. `{ claimId, text,
      // kind, ... }` built from a v2 file where only `tags` was set),
      // so filter by defined value rather than by key presence.
      const keys: Array<"text" | "kind" | "hostStance" | "rationale" | "tags"> = [];
      if (fo.text !== undefined) keys.push("text");
      if (fo.kind !== undefined) keys.push("kind");
      if (fo.hostStance !== undefined) keys.push("hostStance");
      if (fo.rationale !== undefined) keys.push("rationale");
      if (fo.tags !== undefined) keys.push("tags");
      if (keys.length > 0) fieldOverrides = keys;
    }
    return {
      id: c.id,
      videoId: c.videoId,
      kind: c.kind,
      text: c.text,
      hostStance: c.hostStance ?? null,
      entities: c.entities,
      relationships: c.relationships,
      dependencies: (c.dependencies ?? []).map((d) => ({
        target: d.target,
        kind: d.kind,
        rationale: d.rationale ?? null,
      })),
      confidence: c.confidence,
      directTruth: override !== undefined ? override.directTruth : direct,
      derivedTruth: derived,
      truthSource,
      overrideRationale: override?.rationale,
      inVerdictSection: c.inVerdictSection,
      tags: c.tags ?? [],
      fieldOverrides,
    };
  });

  const index: ClaimsIndexFile = {
    generatedAt,
    videoCount: input.videoCount,
    claimCount: claims.length,
    propagation: {
      iterations: propResult.iterations,
      maxDelta: propResult.maxDelta,
      claimsWithDerived: propResult.derived.size,
    },
    claims: indexEntries,
  };

  const depEdges: DependencyGraphFile["edges"] = [];
  for (const c of claims) {
    for (const d of c.dependencies ?? []) {
      if (deleted.has(d.target)) continue;
      depEdges.push({
        from: c.id,
        to: d.target,
        kind: d.kind,
        rationale: d.rationale ?? null,
      });
    }
  }
  const dependencyGraph: DependencyGraphFile = {
    generatedAt,
    edges: depEdges,
    edgeCount: depEdges.length,
  };

  // Contradictions operate on the override-aware view so propagation decisions
  // and the pair-floor test agree.
  const claimsForContradiction = claims.map((c) => {
    const override = overrideById.get(c.id);
    if (!override) return c;
    return { ...c, directTruth: override.directTruth };
  });
  const detected = detectClaimContradictions(claimsForContradiction);

  // Drop dismissed contradictions.
  const dismissed = new Set<string>();
  for (const d of input.dismissedContradictions ?? []) {
    dismissed.add(pairKey(d.a, d.b));
  }
  const surviving = detected.filter(
    (c) => !dismissed.has(pairKey(c.left, c.right)),
  );

  // Append custom (admin-authored) contradictions.
  const claimIds = new Set(claims.map((c) => c.id));
  const custom: ClaimContradiction[] = [];
  for (const cx of input.customContradictions ?? []) {
    if (!claimIds.has(cx.a) || !claimIds.has(cx.b)) continue;
    if (dismissed.has(pairKey(cx.a, cx.b))) continue;
    custom.push({
      kind: "manual",
      left: cx.a,
      right: cx.b,
      sharedEntities: cx.sharedEntities,
      summary: cx.summary,
    });
  }
  const all = [...surviving, ...custom];

  const byKind: Record<string, number> = {};
  for (const c of all) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  const contradictions: ContradictionsFile = {
    generatedAt,
    total: all.length,
    byKind,
    contradictions: all,
  };

  return { index, dependencyGraph, contradictions };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}~~${b}` : `${b}~~${a}`;
}
