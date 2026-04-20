// Claim-level contradiction detection (Plan 3).
//
// Three patterns — each surfaced as a ClaimContradiction record.
//
//   1. pair
//      A contradicts B (declared via A.dependencies), both claims have
//      directTruth ≥ 0.5. The author is asserting both as true despite the
//      explicit contradicts edge.
//
//   2. broken-presupposition
//      A presupposes B, B.directTruth < 0.3. A's stated foundation is
//      considered false by the same author — A is built on sand.
//
//   3. cross-video
//      Two claims from different videos that share ≥1 entity key (post-alias
//      resolution, resolved by the caller) AND have opposite hostStance on
//      semantically similar text. Version-1 similarity is token Jaccard;
//      embedding cosine is deferred (plan §Risks).

import type { Claim, ClaimId, HostStance } from "../claims/types.js";

export interface ClaimContradiction {
  kind: "pair" | "broken-presupposition" | "cross-video";
  left: ClaimId;
  right: ClaimId;
  sharedEntities?: string[];
  similarity?: number;
  summary: string;
}

export interface ClaimContradictionOptions {
  // Jaccard threshold for the cross-video pattern. 0.25 catches thematic
  // overlap without flagging every video that mentions the same entity.
  crossVideoJaccard?: number;
  // True truth anchor for the pair test. Two claims whose directTruth are
  // both ≥ this are considered "both asserted true". Default 0.5.
  pairTruthFloor?: number;
  // Max B.directTruth for broken-presupposition test. Default 0.3.
  brokenPresupFloor?: number;
}

export function detectClaimContradictions(
  claims: Claim[],
  opts: ClaimContradictionOptions = {},
): ClaimContradiction[] {
  const crossVideoJaccard = opts.crossVideoJaccard ?? 0.25;
  const pairFloor = opts.pairTruthFloor ?? 0.5;
  const presupFloor = opts.brokenPresupFloor ?? 0.3;

  const byId = new Map<ClaimId, Claim>();
  for (const c of claims) byId.set(c.id, c);

  const out: ClaimContradiction[] = [];

  // (1) pair contradictions
  for (const a of claims) {
    if (!a.dependencies) continue;
    for (const dep of a.dependencies) {
      if (dep.kind !== "contradicts") continue;
      const b = byId.get(dep.target);
      if (!b) continue;
      if ((a.directTruth ?? 0) < pairFloor) continue;
      if ((b.directTruth ?? 0) < pairFloor) continue;
      out.push({
        kind: "pair",
        left: a.id,
        right: b.id,
        summary: `"${truncate(a.text, 80)}" contradicts "${truncate(b.text, 80)}" but both asserted true (${a.directTruth?.toFixed(2)} vs ${b.directTruth?.toFixed(2)})`,
      });
    }
  }

  // (2) broken presupposition
  for (const a of claims) {
    if (!a.dependencies) continue;
    for (const dep of a.dependencies) {
      if (dep.kind !== "presupposes") continue;
      const b = byId.get(dep.target);
      if (!b) continue;
      if (b.directTruth === undefined) continue;
      if (b.directTruth >= presupFloor) continue;
      out.push({
        kind: "broken-presupposition",
        left: a.id,
        right: b.id,
        summary: `"${truncate(a.text, 80)}" presupposes "${truncate(b.text, 80)}" which has low truth (${b.directTruth.toFixed(2)})`,
      });
    }
  }

  // (3) cross-video topical conflict
  // Group claims by video for an O(V*avg^2 * videos) walk instead of O(N^2)
  // across the whole corpus. At 2 videos × ~10 claims each this is trivial;
  // at 200 videos × 10 claims each it's ~2M pair comparisons, still OK.
  const byVideo = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = byVideo.get(c.videoId) ?? [];
    list.push(c);
    byVideo.set(c.videoId, list);
  }
  const videoIds = [...byVideo.keys()];

  // Pre-tokenize texts once.
  const tokens = new Map<ClaimId, Set<string>>();
  for (const c of claims) tokens.set(c.id, tokenize(c.text));

  for (let i = 0; i < videoIds.length; i++) {
    for (let j = i + 1; j < videoIds.length; j++) {
      const aList = byVideo.get(videoIds[i]) ?? [];
      const bList = byVideo.get(videoIds[j]) ?? [];
      for (const a of aList) {
        const aEnts = new Set(a.entities);
        if (aEnts.size === 0) continue;
        for (const b of bList) {
          const shared = [...aEnts].filter((k) => b.entities.includes(k));
          if (shared.length === 0) continue;
          if (!stanceOpposed(a.hostStance, b.hostStance, a.directTruth, b.directTruth)) {
            continue;
          }
          const sim = jaccard(tokens.get(a.id)!, tokens.get(b.id)!);
          if (sim < crossVideoJaccard) continue;
          out.push({
            kind: "cross-video",
            left: a.id,
            right: b.id,
            sharedEntities: shared,
            similarity: sim,
            summary: `${a.videoId} ${a.hostStance ?? "?"} vs ${b.videoId} ${b.hostStance ?? "?"} — shared: ${shared.slice(0, 3).join(", ")} — jaccard=${sim.toFixed(2)}`,
          });
        }
      }
    }
  }

  return out;
}

// Two claims are "stance opposed" when either:
//   - one hostStance is "asserts" and the other is "denies", OR
//   - one directTruth is ≥ 0.6 and the other is ≤ 0.4 (truth gap)
// We require at least one of these signals — shared entities alone doesn't
// mean the claims disagree.
function stanceOpposed(
  a: HostStance | undefined,
  b: HostStance | undefined,
  aTruth: number | undefined,
  bTruth: number | undefined,
): boolean {
  if ((a === "asserts" && b === "denies") || (a === "denies" && b === "asserts")) {
    return true;
  }
  if (aTruth !== undefined && bTruth !== undefined) {
    if (aTruth >= 0.6 && bTruth <= 0.4) return true;
    if (aTruth <= 0.4 && bTruth >= 0.6) return true;
  }
  return false;
}

function tokenize(s: string): Set<string> {
  // Lowercase, strip punctuation, drop stopwords and 1-2 char tokens. The
  // stopword list is tiny on purpose — cross-video topicality cares about
  // content words, not function words.
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
