// Adapt persisted per-video NLP output into display shapes for the UI.

import type {
  PersistedEntities,
  PersistedRelations,
  VideoNlp,
  DisplayEntity,
  DisplayRelationship,
} from "../types";

// Mirror of src/graph/canonicalize.ts normalizeCanonical. Must stay in sync
// so client-built entity ids match server-built index keys.
function normalizeCanonical(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function adaptNlp(ents: PersistedEntities, rels: PersistedRelations | null): VideoNlp {
  const entityMap = new Map<string, DisplayEntity>();
  const mentionToEntity = new Map<string, string>();

  for (const m of ents.mentions) {
    const key = `${m.label}:${normalizeCanonical(m.canonical)}`;
    let e = entityMap.get(key);
    if (!e) {
      e = {
        id: key,
        type: m.label,
        canonical: m.canonical.replace(/\s+/g, " ").trim(),
        mentions: [],
      };
      entityMap.set(key, e);
    }
    e.mentions.push(m.span);
    mentionToEntity.set(m.id, e.id);
  }

  const entities = [...entityMap.values()];

  const relationships: DisplayRelationship[] = [];
  if (rels) {
    for (const edge of rels.edges) {
      if (!edge.evidence) continue;
      const subjectId = mentionToEntity.get(edge.subjectMentionId);
      const objectId = mentionToEntity.get(edge.objectMentionId);
      if (!subjectId || !objectId) continue;
      relationships.push({
        id: edge.id,
        subjectId,
        objectId,
        predicate: edge.predicate,
        confidence: edge.score,
        evidence: edge.evidence,
      });
    }
  }

  return { entities, relationships };
}
