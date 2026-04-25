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

import type { Claim, ClaimId, DependencyKind, HostStance } from "../claims/types.js";
import { propagateClaims } from "./claim-propagation.js";
import {
  detectClaimContradictions,
  type ClaimContradiction,
} from "./claim-contradictions.js";
import { parseContradictsSubkind } from "./contradicts-subkind.js";

// Redundancy cap for consonance — plan3 A3: a single video was appearing in
// 7/57 SAME-CLAIM pairs all around one topical cluster (Doty/Bennewitz),
// surfacing as "multiple corroborations" when it was really one source.
// Cap pairs-per-video so no video dominates the feed.
const MAX_CONSONANCE_PAIRS_PER_VIDEO = 4;

export type TruthSource = "direct" | "derived" | "override" | "uncalibrated";

// Inbound "this claim was called into question by another claim in the
// same video" edge. Populated from intra-video `contradicts` deps whose
// subkind is `alternative` (competing primary explanation) or
// `undercuts` (reduces probative value). Semantically these aren't
// standoffs — they're the host delivering a verdict against a claim
// they themselves introduced, so they belong next to the *target*
// claim as "evidence against it" rather than on a /contradictions
// standoff page. Truth propagation already consumes these (half-weight
// for alternative, derived-truth cap for undercuts).
export interface CounterEvidenceEntry {
  fromClaimId: ClaimId;
  kind: "alternative" | "undercuts";
  rationale: string | null;
  fromDirectTruth: number | null;
  fromHostStance: Claim["hostStance"] | null;
}

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
  fieldOverrides?: Array<"text" | "kind" | "hostStance" | "rationale">;
  /** Inbound author-delivered evidence-against edges. Missing when the
   *  claim has none. Never populated from cross-video edges — those
   *  stay in contradictions.json / consonance.json. */
  counterEvidence?: CounterEvidenceEntry[];
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
      };
    });

  const pinned = new Map<ClaimId, number>();
  for (const o of overrides) {
    if (!deleted.has(o.claimId)) pinned.set(o.claimId, o.directTruth);
  }

  const propResult = propagateClaims(claims, { pinned });
  const generatedAt = new Date().toISOString();

  // Build the inbound counter-evidence index. For every intra-video
  // `contradicts` dep whose subkind is `alternative` or `undercuts`,
  // attach a row to the target claim.
  const claimById = new Map<ClaimId, Claim>();
  for (const c of claims) claimById.set(c.id, c);
  const counterByTarget = new Map<ClaimId, CounterEvidenceEntry[]>();
  for (const a of claims) {
    if (!a.dependencies) continue;
    for (const dep of a.dependencies) {
      if (dep.kind !== "contradicts") continue;
      const sub = parseContradictsSubkind(dep.rationale);
      if (sub !== "alternative" && sub !== "undercuts") continue;
      const target = claimById.get(dep.target);
      if (!target) continue;
      if (target.videoId !== a.videoId) continue; // intra-video only
      const list = counterByTarget.get(dep.target) ?? [];
      list.push({
        fromClaimId: a.id,
        kind: sub,
        rationale: dep.rationale ?? null,
        fromDirectTruth: a.directTruth ?? null,
        fromHostStance: a.hostStance ?? null,
      });
      counterByTarget.set(dep.target, list);
    }
  }

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
      // Only list fields whose override is actually set. Filter by
      // defined value rather than by key presence so stage-side loaders
      // that materialize undefined keys don't produce false positives.
      const keys: Array<"text" | "kind" | "hostStance" | "rationale"> = [];
      if (fo.text !== undefined) keys.push("text");
      if (fo.kind !== undefined) keys.push("kind");
      if (fo.hostStance !== undefined) keys.push("hostStance");
      if (fo.rationale !== undefined) keys.push("rationale");
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
      fieldOverrides,
      counterEvidence: counterByTarget.get(c.id),
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

  // Claim lookup for the stance-opposition gate applied at SAME-CLAIM
  // promotion time.
  const byIdForStance = new Map<ClaimId, Claim>();
  for (const c of claims) byIdForStance.set(c.id, c);

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
    if (
      v.verdict === "LOGICAL-CONTRADICTION" ||
      v.verdict === "DEBUNKS" ||
      v.verdict === "UNDERCUTS" ||
      v.verdict === "ALTERNATIVE"
    ) {
      // plan3 follow-up: UNDERCUTS and ALTERNATIVE are real
      // disagreement signals the verifier certified. Surface them too
      // with their verdict label so the UI can render them as a lower
      // tier. Only COMPLEMENTARY / IRRELEVANT still drop.
      surviving.push(enriched);
    } else if (v.verdict === "SAME-CLAIM") {
      // plan3 A3: reject SAME-CLAIM pairs where the two claims' hostStances
      // are opposed. If one video asserts and the other denies, the
      // verdicter overcalled — that's disagreement on framing, not
      // corroboration.
      const leftClaim = byIdForStance.get(c.left);
      const rightClaim = byIdForStance.get(c.right);
      const stanceOpposed = stancesOpposed(leftClaim?.hostStance, rightClaim?.hostStance);
      if (stanceOpposed) {
        droppedTotal++;
        droppedByVerdict["SAME-CLAIM-stance-mismatch"] =
          (droppedByVerdict["SAME-CLAIM-stance-mismatch"] ?? 0) + 1;
        continue;
      }
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

  // Redundancy cap (plan3 A3). If one video dominates the consonance feed,
  // drop the tail past the cap — sorted by pair-id so the choice is
  // deterministic.
  const capped = capConsonancePerVideo(consonanceRows, MAX_CONSONANCE_PAIRS_PER_VIDEO);
  const cappedDrop = consonanceRows.length - capped.length;
  if (cappedDrop > 0) {
    droppedTotal += cappedDrop;
    droppedByVerdict["SAME-CLAIM-redundancy-cap"] =
      (droppedByVerdict["SAME-CLAIM-redundancy-cap"] ?? 0) + cappedDrop;
  }

  const consonance: ConsonanceFile = {
    schemaVersion: 1,
    generatedAt,
    count: capped.length,
    agreements: capped,
  };

  return { index, dependencyGraph, contradictions, consonance };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}~~${b}` : `${b}~~${a}`;
}

function stancesOpposed(
  a: HostStance | undefined | null,
  b: HostStance | undefined | null,
): boolean {
  return (a === "asserts" && b === "denies") || (a === "denies" && b === "asserts");
}

// Per-video cap over consonance rows. Each pair counts once per video; rows
// exceeding either side's cap are dropped.
function capConsonancePerVideo(
  rows: ClaimContradiction[],
  cap: number,
): ClaimContradiction[] {
  const sorted = [...rows].sort((x, y) => {
    const xk = pairKey(x.left, x.right);
    const yk = pairKey(y.left, y.right);
    return xk < yk ? -1 : xk > yk ? 1 : 0;
  });
  const counts = new Map<string, number>();
  const videoOf = (id: ClaimId) => id.split(":")[0];
  const out: ClaimContradiction[] = [];
  for (const r of sorted) {
    const va = videoOf(r.left);
    const vb = videoOf(r.right);
    if ((counts.get(va) ?? 0) >= cap) continue;
    if ((counts.get(vb) ?? 0) >= cap) continue;
    counts.set(va, (counts.get(va) ?? 0) + 1);
    counts.set(vb, (counts.get(vb) ?? 0) + 1);
    out.push(r);
  }
  return out;
}
