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

  // For novelty, iterate over pairs of entities sharing at least one neighbor.
  const entityIds = [...neighbors.keys()];
  const candidates = new Map<string, NovelCandidate>();
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      const a = entityIds[i];
      const b = entityIds[j];
      if (asserted.has(`${a}|${b}`)) continue;
      const sharedN = intersect(neighbors.get(a)!, neighbors.get(b)!);
      const sharedT = intersect(transcripts.get(a) ?? new Set<string>(), transcripts.get(b) ?? new Set<string>());
      if (sharedN.size + sharedT.size < minSupport) continue;
      const support: Relationship[] = [];
      for (const r of rels) {
        const touchesA = r.subjectId === a || r.objectId === a;
        const touchesB = r.subjectId === b || r.objectId === b;
        if (!touchesA && !touchesB) continue;
        if (sharedN.has(r.subjectId) || sharedN.has(r.objectId) || sharedT.has(r.evidence.transcriptId)) {
          support.push(r);
        }
      }
      const score =
        [...sharedN].length * 2 +
        [...sharedT].length +
        support.reduce((s, r) => s + r.confidence, 0) * 0.1;
      const key = `${a}|${b}`;
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
