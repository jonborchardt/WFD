// Novel-relationship detection.
//
// Definition: a pair of entities is "novel" if they co-occur in the same
// relationship context multiple times (e.g. both appear in relationships
// that share an endpoint, or both appear in the same transcript) but have
// no directly asserted edge between them.
//
// We score candidates by how many distinct contexts support them, weighted
// by the confidence of the supporting edges. High-score candidates are the
// most "load bearing" implicit links.

import { Relationship } from "../shared/types.js";
import { GraphStore } from "../graph/store.js";

export interface NovelCandidate {
  subjectId: string;
  objectId: string;
  score: number;
  supportingEdges: Relationship[];
  sharedEntities: string[];
  sharedTranscripts: string[];
}

export interface NovelOptions {
  minSupport?: number;
  limit?: number;
}

export function detectNovel(
  store: GraphStore,
  opts: NovelOptions = {},
): NovelCandidate[] {
  const minSupport = opts.minSupport ?? 2;
  const limit = opts.limit ?? 50;

  const rels = store.relationships();
  // Asserted edges we should exclude.
  const asserted = new Set<string>();
  for (const r of rels) {
    asserted.add(`${r.subjectId}|${r.objectId}`);
    asserted.add(`${r.objectId}|${r.subjectId}`);
  }

  // For each entity, collect (a) its neighbors via edges, (b) the transcripts
  // it appears in. A novel candidate (A, B) is any pair sharing at least one
  // neighbor or transcript with no asserted edge between them.
  const neighbors = new Map<string, Set<string>>();
  const transcripts = new Map<string, Set<string>>();

  for (const r of rels) {
    for (const [a, b] of [
      [r.subjectId, r.objectId],
      [r.objectId, r.subjectId],
    ]) {
      const n = neighbors.get(a) ?? new Set<string>();
      n.add(b);
      neighbors.set(a, n);
      const t = transcripts.get(a) ?? new Set<string>();
      t.add(r.evidence.transcriptId);
      transcripts.set(a, t);
    }
  }

  // Build a per-relationship lookup by entity so we don't linear-scan
  // all rels inside the inner loop — the old O(N²×E) approach was
  // combinatorial on large graphs.
  const relsByEntity = new Map<string, Relationship[]>();
  for (const r of rels) {
    for (const ep of [r.subjectId, r.objectId]) {
      const list = relsByEntity.get(ep) ?? [];
      list.push(r);
      relsByEntity.set(ep, list);
    }
  }

  // For novelty, iterate over pairs of entities that share at least
  // one neighbor. Instead of brute-force N² entity pairs, walk each
  // entity's neighbor set and check neighbors-of-neighbors — this is
  // O(sum of (degree²)) which is much smaller than O(N²) for sparse
  // graphs, and the pipeline graph is sparse.
  const candidates = new Map<string, NovelCandidate>();
  const seen = new Set<string>();
  for (const [a, aNeighbors] of neighbors) {
    for (const mid of aNeighbors) {
      for (const b of neighbors.get(mid) ?? []) {
        if (b === a) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (asserted.has(`${a}|${b}`)) continue;
        const sharedN = intersect(aNeighbors, neighbors.get(b)!);
        const sharedT = intersect(
          transcripts.get(a) ?? new Set<string>(),
          transcripts.get(b) ?? new Set<string>(),
        );
        if (sharedN.size + sharedT.size < minSupport) continue;
        // Collect supporting edges from the per-entity index
        // instead of scanning every relationship.
        const support: Relationship[] = [];
        const supportIds = new Set<string>();
        for (const ep of [a, b]) {
          for (const r of relsByEntity.get(ep) ?? []) {
            if (supportIds.has(r.id)) continue;
            if (
              sharedN.has(r.subjectId) ||
              sharedN.has(r.objectId) ||
              sharedT.has(r.evidence.transcriptId)
            ) {
              support.push(r);
              supportIds.add(r.id);
            }
          }
        }
        const score =
          sharedN.size * 2 +
          sharedT.size +
          support.reduce((s, r) => s + r.confidence, 0) * 0.1;
        candidates.set(key, {
          subjectId: a,
          objectId: b,
          score,
          supportingEdges: support,
          sharedEntities: [...sharedN],
          sharedTranscripts: [...sharedT],
        });
      }
    }
  }

  return [...candidates.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

export function formatNovel(
  store: GraphStore,
  candidate: NovelCandidate,
): string {
  const a = store.getEntity(candidate.subjectId)?.canonical ?? candidate.subjectId;
  const b = store.getEntity(candidate.objectId)?.canonical ?? candidate.objectId;
  return `${a} <-?-> ${b}  score=${candidate.score.toFixed(2)}  shared=${candidate.sharedEntities.length}+${candidate.sharedTranscripts.length}`;
}
