// Claim-level contradiction detection.
//
// Three patterns — each surfaced as a ClaimContradiction record.
//
//   1. pair
//      A contradicts B (declared via A.dependencies), both claims have
//      directTruth ≥ 0.5. The author is asserting both as true despite the
//      explicit contradicts edge. Post-Plan-04 the pair detector also
//      honors the typed `contradicts` subkind encoded as a `[logical]` /
//      `[debunks]` / `[alternative]` / `[undercuts]` prefix in the
//      dep's rationale (see contradicts-subkind.ts): only `logical` and
//      `debunks` surface as pair contradictions; `alternative` and
//      `undercuts` live in the DAG for propagation + display but are
//      not contradictions in the reported sense.
//
//   2. broken-presupposition
//      A presupposes B, B.directTruth < 0.3. A's stated foundation is
//      considered false by the same author — A is built on sand.
//
//   3. cross-video
//      Two claims from different videos. Post-Plan-04 the candidate
//      generator consumes an optional `embeddings` map:
//        - if provided: cosine similarity drives the match; pass when
//          (cosine ≥ crossVideoCosineMin AND stance opposed) OR
//          (cosine ≥ crossVideoCosineStrict regardless of stance).
//        - if missing: falls back to the Plan 3 v1 signal — token
//          Jaccard ≥ crossVideoJaccard OR shared-entity ≥ strongEntityOverlap,
//          gated on explicit asserts↔denies stance opposition.
//      Entity overlap ≥ 1 is required in both paths — shared entities
//      is the minimum signal that two claims are about the same thing.

import type { Claim, ClaimId, HostStance } from "../claims/types.js";
import {
  parseContradictsSubkind,
  type ContradictsSubkind,
} from "./contradicts-subkind.js";

export interface ClaimContradiction {
  kind: "pair" | "broken-presupposition" | "cross-video" | "manual";
  // For pair contradictions: the typed subkind parsed from the dep's
  // rationale prefix. Missing means the dep lacked a subkind prefix
  // (pre-Plan-03-v2 claim files) and was treated as "logical" by
  // default.
  subkind?: ContradictsSubkind;
  left: ClaimId;
  right: ClaimId;
  sharedEntities?: string[];
  similarity?: number;
  // For cross-video only: which path triggered the match.
  //   "jaccard"        — text-similarity threshold cleared directly
  //   "strong-overlap" — Jaccard was weak but ≥ strongEntityOverlap
  //                      entities were shared, so the entity
  //                      co-occurrence path fired. Useful for UI triage
  //                      because strong-overlap matches tend to be
  //                      noisier than jaccard matches.
  //   "cosine"         — Plan 04 embedding cosine path
  matchReason?: "jaccard" | "strong-overlap" | "cosine";
  summary: string;
  // Plan 04 verification cache slot — apply after the verifier AI pass
  // writes to data/claims/contradiction-verdicts.json. null = pending,
  // {verdict:…} = verified. UI filters on this.
  verified?: null | {
    verdict:
      | "LOGICAL-CONTRADICTION"
      | "DEBUNKS"
      | "UNDERCUTS"
      | "ALTERNATIVE"
      | "COMPLEMENTARY"
      | "IRRELEVANT"
      | "SAME-CLAIM";
    reasoning?: string;
    by?: "ai" | "operator";
  };
}

export interface ClaimContradictionOptions {
  // Minimum Jaccard on claim text to flag cross-video pairs as topical.
  // Below this threshold we fall back to shared-entity count (see
  // `strongEntityOverlap`) as a topicality proxy.
  crossVideoJaccard?: number;
  // Minimum shared entities when text similarity is weak. Entity
  // co-occurrence stands in as a topicality signal when wording
  // diverges.
  strongEntityOverlap?: number;
  // Plan 04: minimum embedding cosine to flag a cross-video pair when
  // stance is also opposed. Below this but above the strict threshold,
  // we still fire — the semantic similarity is high enough that
  // verification is warranted even without explicit denies.
  crossVideoCosineMin?: number;
  // Plan 04: minimum embedding cosine to flag regardless of stance.
  // Very-similar claims from different videos are worth verifying even
  // without asserts↔denies opposition, because they might be the same
  // thesis phrased differently (SAME-CLAIM verdict) or a cross-video
  // logical contradiction we'd otherwise miss.
  crossVideoCosineStrict?: number;
  // Truth anchor for the pair test. Two claims whose directTruth are
  // both ≥ this are considered "both asserted true". Default 0.5.
  pairTruthFloor?: number;
  // Max B.directTruth for broken-presupposition test. Default 0.3.
  brokenPresupFloor?: number;
  // Plan 04: if provided, the cross-video generator uses embedding
  // cosine as the primary similarity signal. Missing entries fall
  // back to Jaccard. Map is keyed by ClaimId.
  embeddings?: Map<ClaimId, Float32Array | number[]>;
}

export function detectClaimContradictions(
  claims: Claim[],
  opts: ClaimContradictionOptions = {},
): ClaimContradiction[] {
  const crossVideoJaccard = opts.crossVideoJaccard ?? 0.10;
  const strongEntityOverlap = opts.strongEntityOverlap ?? 2;
  const crossVideoCosineMin = opts.crossVideoCosineMin ?? 0.55;
  const crossVideoCosineStrict = opts.crossVideoCosineStrict ?? 0.70;
  const pairFloor = opts.pairTruthFloor ?? 0.5;
  const presupFloor = opts.brokenPresupFloor ?? 0.3;
  const embeddings = opts.embeddings;

  const byId = new Map<ClaimId, Claim>();
  for (const c of claims) byId.set(c.id, c);

  const out: ClaimContradiction[] = [];

  // (1) pair contradictions — v2 typed-subkind aware.
  for (const a of claims) {
    if (!a.dependencies) continue;
    for (const dep of a.dependencies) {
      if (dep.kind !== "contradicts") continue;
      const b = byId.get(dep.target);
      if (!b) continue;

      // Parse the subkind prefix. Missing prefix = pre-v2 claim file;
      // default to "logical" so back-compat matches prior behavior.
      const subkind: ContradictsSubkind =
        parseContradictsSubkind(dep.rationale) ?? "logical";

      // Within one video the author is the same party on both sides, so
      // an `alternative` / `undercuts` dep isn't a standoff — it's the
      // host grading a claim they themselves introduced. Those signals
      // belong to truth propagation (which already consumes them; see
      // claim-propagation.ts) and to the target claim's derivedTruth,
      // not to `/contradictions`. Only `logical` and `debunks`
      // represent self-contradiction worth flagging as a pair.
      // Cross-video ALTERNATIVE / UNDERCUTS are different (two
      // independent authors judged by the AI verifier) and surface
      // separately in claim-indexes.ts.
      if (subkind !== "logical" && subkind !== "debunks") continue;

      if (subkind === "debunks") {
        if ((a.directTruth ?? 0) < 0.7) continue;
        if ((b.directTruth ?? 0) < 0.7) continue;
      } else {
        if ((a.directTruth ?? 0) < pairFloor) continue;
        if ((b.directTruth ?? 0) < pairFloor) continue;
      }

      out.push({
        kind: "pair",
        subkind,
        left: a.id,
        right: b.id,
        summary: `"${truncate(a.text, 80)}" contradicts "${truncate(b.text, 80)}" but both asserted true (${(a.directTruth ?? 0).toFixed(2)} vs ${(b.directTruth ?? 0).toFixed(2)}) [${subkind}]`,
      });
    }
  }

  // (2) broken presupposition — plan3 A1: require truth-asymmetry so
  // we don't surface presupposition chains between two equally-false
  // claims ("NASA created chupacabra presupposes chupacabra is real"
  // when both are 0.15). A real broken-presupposition is "A is
  // asserted (truth ≥ 0.5) but its B-foundation is false (truth < 0.3)".
  for (const a of claims) {
    if (!a.dependencies) continue;
    for (const dep of a.dependencies) {
      if (dep.kind !== "presupposes") continue;
      const b = byId.get(dep.target);
      if (!b) continue;
      if (b.directTruth === undefined) continue;
      if (b.directTruth >= presupFloor) continue;
      if ((a.directTruth ?? 0) < pairFloor) continue;
      out.push({
        kind: "broken-presupposition",
        left: a.id,
        right: b.id,
        summary: `"${truncate(a.text, 80)}" (${(a.directTruth ?? 0).toFixed(2)}) presupposes "${truncate(b.text, 80)}" which has low truth (${b.directTruth.toFixed(2)})`,
      });
    }
  }

  // (3) cross-video — v2 with optional embedding cosine.
  const byVideo = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = byVideo.get(c.videoId) ?? [];
    list.push(c);
    byVideo.set(c.videoId, list);
  }
  const videoIds = [...byVideo.keys()];

  // Pre-tokenize text (used by the Jaccard fallback path).
  const tokens = new Map<ClaimId, Set<string>>();
  for (const c of claims) tokens.set(c.id, tokenize(c.text));

  for (let i = 0; i < videoIds.length; i++) {
    for (let j = i + 1; j < videoIds.length; j++) {
      const aList = byVideo.get(videoIds[i]) ?? [];
      const bList = byVideo.get(videoIds[j]) ?? [];
      for (const a of aList) {
        const aEnts = new Set(a.entities);
        if (aEnts.size === 0) continue;
        const aEmb = embeddings?.get(a.id);
        for (const b of bList) {
          const shared = [...aEnts].filter((k) => b.entities.includes(k));
          if (shared.length === 0) continue;

          const stanceOpposed = explicitStanceOpposed(a.hostStance, b.hostStance);

          let pass = false;
          let matchReason: "jaccard" | "strong-overlap" | "cosine" = "jaccard";
          let similarity = 0;

          const bEmb = embeddings?.get(b.id);
          if (aEmb && bEmb) {
            // Plan 04 cosine path.
            similarity = cosine(aEmb, bEmb);
            matchReason = "cosine";
            pass =
              (similarity >= crossVideoCosineMin && stanceOpposed) ||
              similarity >= crossVideoCosineStrict;
          } else {
            // Plan 3 v1 Jaccard / strong-overlap fallback. Requires
            // stance opposition in both paths — truth-gap-only is
            // dominated by AI scoring jitter on near-duplicate claims.
            if (!stanceOpposed) continue;
            similarity = jaccard(tokens.get(a.id)!, tokens.get(b.id)!);
            const jaccardOk = similarity >= crossVideoJaccard;
            const strongOk = shared.length >= strongEntityOverlap;
            if (jaccardOk) {
              matchReason = "jaccard";
              pass = true;
            } else if (strongOk) {
              matchReason = "strong-overlap";
              pass = true;
            }
          }
          if (!pass) continue;

          out.push({
            kind: "cross-video",
            left: a.id,
            right: b.id,
            sharedEntities: shared,
            similarity,
            matchReason,
            verified: null,
            summary:
              matchReason === "cosine"
                ? `${a.videoId} ${a.hostStance ?? "?"} vs ${b.videoId} ${b.hostStance ?? "?"} — cos=${similarity.toFixed(2)} — shared: ${shared.slice(0, 3).join(", ")} (pending verify)`
                : `${a.videoId} ${a.hostStance ?? "?"} vs ${b.videoId} ${b.hostStance ?? "?"} — shared: ${shared.slice(0, 3).join(", ")} — jaccard=${similarity.toFixed(2)} (${matchReason})`,
          });
        }
      }
    }
  }

  return out;
}

// Two claims are "stance opposed" when one asserts what the other denies.
function explicitStanceOpposed(
  a: HostStance | undefined,
  b: HostStance | undefined,
): boolean {
  return (a === "asserts" && b === "denies") || (a === "denies" && b === "asserts");
}

function tokenize(s: string): Set<string> {
  const stop = new Set([
    "the", "and", "but", "for", "with", "that", "this", "from", "into",
    "than", "then", "has", "have", "had", "not", "was", "were", "are",
    "been", "being", "its", "their", "they", "them", "also", "such",
    "which", "what", "when", "where", "while", "who", "whom", "whose",
  ]);
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

// Cosine similarity over two equal-length vectors. Embeddings are
// normalized at write time, so this could be a pure dot product — we
// still divide to be safe against non-normalized inputs (e.g. operator
// hand-edited cache file).
function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
