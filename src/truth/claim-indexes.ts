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
  verifiedDropped?: { total: number; byVerdict: Record<string, number> };
  contradictions: ClaimContradiction[];
}

// Plan 04 §D4 — cross-video SAME-CLAIM pairs promoted to agreements.
export interface ConsonanceFile {
  schemaVersion: 1;
  generatedAt: string;
  count: number;
  agreements: ClaimContradiction[];
}

// Plan 04 §D3 — verdict cache row. Keyed by sorted (left, right).
export interface VerdictCacheEntry {
  left: ClaimId;
  right: ClaimId;
  verdict:
    | "LOGICAL-CONTRADICTION"
    | "DEBUNKS"
    | "UNDERCUTS"
    | "ALTERNATIVE"
    | "COMPLEMENTARY"
    | "IRRELEVANT"
    | "SAME-CLAIM";
  reasoning?: string | null;
  by?: "ai" | "operator";
  at?: string;
  // Optional text-hash signatures of the two claims at verdict time.
  // When non-empty, apply.mjs invalidates the verdict if either hash
  // differs from the current claim's text hash — guards against stale
  // verdicts after claim re-extraction.
  leftTextHash?: string;
  rightTextHash?: string;
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
  /**
   * Plan 04 — optional sentence embeddings (keyed by claim id). When
   * supplied, the cross-video candidate generator uses cosine
   * similarity; otherwise it falls back to Jaccard.
   */
  embeddings?: Map<ClaimId, Float32Array | number[]>;
  /**
   * Plan 04 — optional AI verification verdict cache (keyed by sorted
   * "left|right" pair). When present, contradictions.json surfaces
   * only LOGICAL-CONTRADICTION and DEBUNKS; UNDERCUTS / ALTERNATIVE
   * stay in the DAG but aren't flagged; COMPLEMENTARY / IRRELEVANT
   * are dropped; SAME-CLAIM moves to the consonance file.
   */
  verdicts?: Map<string, VerdictCacheEntry>;
  /**
   * Plan 04 — hash helper so stale verdicts (claim text changed since
   * verdict was captured) are invalidated. Supplier passes `{id → hash}`
   * for every claim; if a verdict's leftTextHash/rightTextHash diverges
   * from the current hash, the verdict is treated as missing.
   */
  claimTextHash?: Map<ClaimId, string>;
}

export interface BuildClaimIndexesResult {
  index: ClaimsIndexFile;
  dependencyGraph: DependencyGraphFile;
  contradictions: ContradictionsFile;
  /** Plan 04 §D4 — SAME-CLAIM pairs promoted to agreements. */
  consonance: ConsonanceFile;
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
  const detected = detectClaimContradictions(claimsForContradiction, {
    embeddings: input.embeddings,
  });

  // Drop dismissed contradictions.
  const dismissed = new Set<string>();
  for (const d of input.dismissedContradictions ?? []) {
    dismissed.add(pairKey(d.a, d.b));
  }

  // Plan 04 §D — apply verdicts + invalidate stale ones by claim-text hash.
  const verdictMap = input.verdicts ?? new Map<string, VerdictCacheEntry>();
  const hashMap = input.claimTextHash ?? new Map<ClaimId, string>();
  function currentVerdict(a: ClaimId, b: ClaimId): VerdictCacheEntry | undefined {
    const key = pairKey(a, b);
    const v = verdictMap.get(key);
    if (!v) return undefined;
    // Invalidate if hash drifted since the verdict was captured.
    if (v.leftTextHash || v.rightTextHash) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const curLeft = hashMap.get(lo);
      const curRight = hashMap.get(hi);
      if (v.leftTextHash && curLeft && v.leftTextHash !== curLeft) return undefined;
      if (v.rightTextHash && curRight && v.rightTextHash !== curRight) return undefined;
    }
    return v;
  }

  const surviving: ClaimContradiction[] = [];
  const consonanceRows: ClaimContradiction[] = [];
  const droppedByVerdict: Record<string, number> = {};
  let droppedTotal = 0;

  for (const c of detected) {
    if (dismissed.has(pairKey(c.left, c.right))) continue;

    // broken-presupposition is mechanically derived — always pass through.
    if (c.kind === "broken-presupposition") {
      surviving.push(c);
      continue;
    }

    const v = currentVerdict(c.left, c.right);
    if (!v) {
      // Pending verification: preserve with verified: null so the admin UI
      // can surface it. Public UI filters verified: null out. Plan 04 §E2.
      surviving.push({ ...c, verified: null });
      continue;
    }
    const enriched: ClaimContradiction = {
      ...c,
      verified: { verdict: v.verdict, reasoning: v.reasoning ?? undefined, by: v.by ?? "ai" },
    };
    if (v.verdict === "LOGICAL-CONTRADICTION" || v.verdict === "DEBUNKS") {
      surviving.push(enriched);
    } else if (v.verdict === "SAME-CLAIM") {
      consonanceRows.push(enriched);
      droppedTotal++;
      droppedByVerdict[v.verdict] = (droppedByVerdict[v.verdict] ?? 0) + 1;
    } else {
      // UNDERCUTS / ALTERNATIVE / COMPLEMENTARY / IRRELEVANT — drop from
      // the public view; propagation still honors UNDERCUTS / ALTERNATIVE
      // via the dependency edges themselves.
      droppedTotal++;
      droppedByVerdict[v.verdict] = (droppedByVerdict[v.verdict] ?? 0) + 1;
    }
  }

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
    verifiedDropped:
      droppedTotal > 0 ? { total: droppedTotal, byVerdict: droppedByVerdict } : undefined,
    contradictions: all,
  };

  const consonance: ConsonanceFile = {
    schemaVersion: 1,
    generatedAt,
    count: consonanceRows.length,
    agreements: consonanceRows,
  };

  return { index, dependencyGraph, contradictions, consonance };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}~~${b}` : `${b}~~${a}`;
}
