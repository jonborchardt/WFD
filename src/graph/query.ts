// Query layer over the graph store.
//
// Free-text search returns entity matches with disambiguation; entity pages
// group relationships by predicate; each row points at its evidence and a
// timestamped deep link. A CLI version of the same query is exported so
// scripts can run the lookups without the UI.

import { Entity, Relationship, RelationshipType } from "../shared/types.js";
import { GraphStore } from "./store.js";

export interface SearchHit {
  entity: Entity;
  score: number;
  matchedOn: "canonical" | "alias";
}

export function searchEntities(
  store: GraphStore,
  query: string,
  limit = 20,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const e of store.entities()) {
    const canonical = e.canonical.toLowerCase();
    if (canonical === q) {
      hits.push({ entity: e, score: 3, matchedOn: "canonical" });
      continue;
    }
    if (canonical.includes(q)) {
      hits.push({ entity: e, score: 2, matchedOn: "canonical" });
      continue;
    }
    const alias = e.aliases.find((a) => a.toLowerCase().includes(q));
    if (alias) hits.push({ entity: e, score: 1, matchedOn: "alias" });
  }
  hits.sort((a, b) => b.score - a.score || a.entity.canonical.localeCompare(b.entity.canonical));
  return hits.slice(0, limit);
}

export interface GroupedRelationships {
  entity: Entity;
  groups: Array<{
    predicate: RelationshipType;
    rows: Array<{
      relationship: Relationship;
      counterpart: Entity | undefined;
      deepLink: string;
    }>;
  }>;
}

export function entityPage(
  store: GraphStore,
  entityId: string,
): GroupedRelationships | null {
  const entity = store.getEntity(entityId);
  if (!entity) return null;
  const rels = store.byEntity(entityId);
  const byPredicate = new Map<RelationshipType, Relationship[]>();
  for (const r of rels) {
    const list = byPredicate.get(r.predicate) ?? [];
    list.push(r);
    byPredicate.set(r.predicate, list);
  }
  const groups = [...byPredicate.entries()].map(([predicate, list]) => ({
    predicate,
    rows: list.map((relationship) => {
      const otherId =
        relationship.subjectId === entityId
          ? relationship.objectId
          : relationship.subjectId;
      return {
        relationship,
        counterpart: store.getEntity(otherId),
        deepLink: `https://www.youtube.com/watch?v=${encodeURIComponent(relationship.evidence.transcriptId)}&t=${Math.floor(relationship.evidence.timeStart)}s`,
      };
    }),
  }));
  return { entity, groups };
}

// Reverse query: "what claims involve this entity in role X?"
// role is "subject" or "object".
export function reverseQuery(
  store: GraphStore,
  entityId: string,
  role: "subject" | "object",
  predicate?: RelationshipType,
): Relationship[] {
  return store.relationships().filter((r) => {
    const match = role === "subject" ? r.subjectId === entityId : r.objectId === entityId;
    if (!match) return false;
    if (predicate && r.predicate !== predicate) return false;
    return true;
  });
}

// CLI-friendly single-line formatter for a relationship row.
export function formatRelationship(
  store: GraphStore,
  r: Relationship,
): string {
  const subj = store.getEntity(r.subjectId)?.canonical ?? r.subjectId;
  const obj = store.getEntity(r.objectId)?.canonical ?? r.objectId;
  const truth =
    r.derivedTruth !== undefined
      ? ` truth=${r.derivedTruth.toFixed(2)}`
      : r.directTruth !== undefined
        ? ` truth=${r.directTruth.toFixed(2)}`
        : "";
  return `${subj} -[${r.predicate} ${r.confidence.toFixed(2)}${truth}]-> ${obj}  @ ${r.evidence.transcriptId}:${Math.floor(r.evidence.timeStart)}s`;
}

export function cliQuery(store: GraphStore, query: string): string {
  const hits = searchEntities(store, query);
  if (hits.length === 0) return `no matches for "${query}"`;
  const lines: string[] = [];
  for (const h of hits.slice(0, 5)) {
    lines.push(`# ${h.entity.canonical} [${h.entity.type}]`);
    const page = entityPage(store, h.entity.id);
    if (!page) continue;
    for (const g of page.groups) {
      for (const row of g.rows) {
        lines.push("  " + formatRelationship(store, row.relationship));
      }
    }
  }
  return lines.join("\n");
}
