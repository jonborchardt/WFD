// Contradiction and loop detection.
//
// Contradiction: two relationships with the same subject/predicate/object
// whose directTruth values disagree (one trueish, one falseish). We key by
// the canonical edge tuple so evidence pointers don't force a false miss.
// Also detects the dual case: pairs where the same edge is asserted with
// contradictory predicates that we treat as mutually exclusive.
//
// Loops: cycles in the implication graph built from directed relationships.
// A cycle whose edges all have derivedTruth >= 0.5 is flagged as a potential
// "self-supporting" ring that might be circular reasoning.

import { Relationship, RelationshipType } from "../shared/types.js";
import { GraphStore } from "../graph/store.js";

export interface Contradiction {
  kind: "truth" | "predicate";
  subjectId: string;
  objectId: string;
  left: Relationship;
  right: Relationship;
  summary: string;
}

export interface Loop {
  edges: Relationship[];
  summary: string;
}

// Pairs of predicates we consider mutually exclusive.
const EXCLUSIVE: Array<[RelationshipType, RelationshipType]> = [
  ["loves", "hates"],
  ["accused", "denied"],
  ["funds", "funded-by"],
  ["employs", "worked-for"],
];

function edgeKey(r: Relationship): string {
  return `${r.subjectId}|${r.predicate}|${r.objectId}`;
}

export function detectContradictions(store: GraphStore): Contradiction[] {
  const out: Contradiction[] = [];
  const rels = store.relationships();

  // Truth contradictions on the same edge.
  const byEdge = new Map<string, Relationship[]>();
  for (const r of rels) {
    const key = edgeKey(r);
    const list = byEdge.get(key) ?? [];
    list.push(r);
    byEdge.set(key, list);
  }
  for (const list of byEdge.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.directTruth === undefined || b.directTruth === undefined) continue;
        if ((a.directTruth >= 0.5) !== (b.directTruth >= 0.5)) {
          out.push({
            kind: "truth",
            subjectId: a.subjectId,
            objectId: a.objectId,
            left: a,
            right: b,
            summary: `same edge asserted with opposing verdicts (${a.directTruth.toFixed(2)} vs ${b.directTruth.toFixed(2)})`,
          });
        }
      }
    }
  }

  // Predicate contradictions: same (subject,object) asserted with mutually
  // exclusive predicates that both claim to be true.
  const byPair = new Map<string, Relationship[]>();
  for (const r of rels) {
    const key = `${r.subjectId}|${r.objectId}`;
    const list = byPair.get(key) ?? [];
    list.push(r);
    byPair.set(key, list);
  }
  for (const list of byPair.values()) {
    for (const [p, q] of EXCLUSIVE) {
      const a = list.find((r) => r.predicate === p && (r.directTruth ?? 0) >= 0.5);
      const b = list.find((r) => r.predicate === q && (r.directTruth ?? 0) >= 0.5);
      if (a && b) {
        out.push({
          kind: "predicate",
          subjectId: a.subjectId,
          objectId: a.objectId,
          left: a,
          right: b,
          summary: `mutually exclusive predicates both asserted true: ${p} vs ${q}`,
        });
      }
    }
  }
  return out;
}

// Cycle detection over the directed relationship graph. Uses DFS with a
// recursion stack; collects simple cycles once each.
export function detectLoops(store: GraphStore): Loop[] {
  const rels = store.relationships();
  const out: Loop[] = [];
  const adj = new Map<string, Relationship[]>();
  for (const r of rels) {
    const list = adj.get(r.subjectId) ?? [];
    list.push(r);
    adj.set(r.subjectId, list);
  }
  const stack: Relationship[] = [];
  const onStack = new Set<string>();
  const seenCycles = new Set<string>();

  function dfs(nodeId: string): void {
    onStack.add(nodeId);
    for (const r of adj.get(nodeId) ?? []) {
      if (onStack.has(r.objectId)) {
        // Found a cycle ending here. Walk back up the stack.
        const cycleEdges: Relationship[] = [];
        for (let i = stack.length - 1; i >= 0; i--) {
          cycleEdges.unshift(stack[i]);
          if (stack[i].subjectId === r.objectId) break;
        }
        cycleEdges.push(r);
        const allTrue = cycleEdges.every(
          (e) => (e.derivedTruth ?? e.directTruth ?? 0) >= 0.5,
        );
        if (allTrue) {
          const key = cycleEdges
            .map((e) => e.id)
            .sort()
            .join("#");
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            out.push({
              edges: cycleEdges,
              summary: `self-supporting loop across ${cycleEdges.length} edges`,
            });
          }
        }
        continue;
      }
      stack.push(r);
      dfs(r.objectId);
      stack.pop();
    }
    onStack.delete(nodeId);
  }

  for (const entity of store.entities()) {
    if (!onStack.has(entity.id)) dfs(entity.id);
  }
  return out;
}

export interface ConflictReport {
  contradictions: Contradiction[];
  loops: Loop[];
}

export function buildConflictReport(store: GraphStore): ConflictReport {
  return {
    contradictions: detectContradictions(store),
    loops: detectLoops(store),
  };
}
