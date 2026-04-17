// Adapter layer between the neural extraction output
// (PersistedEntities + PersistedRelations, written by the entities and
// relations stages) and the shared graph types (Entity, Relationship)
// consumed by src/graph/, src/truth/, and the UI server.
//
// The on-disk per-video shapes are:
//   data/entities/<id>.json  → PersistedEntities { mentions[] }
//   data/relations/<id>.json → PersistedRelations { edges[] }
//
// The downstream shapes are:
//   Entity       { id, type, canonical, aliases, mentions[] }
//   Relationship { id, subjectId, predicate, objectId, evidence, ... }
//
// The grouping rule: mentions with the same (label, lowercased
// canonical) collapse into one Entity record. The entity id is
// `${type}:${canonical.toLowerCase()}` — this mirrors the old nlp
// module's keying so downstream code doesn't need schema changes.
// Relation endpoints, which the neural pipeline records as mention ids
// (m_0001, ...), are rewritten to these entity ids during adaptation.

import {
  createRelationship,
  Entity,
  EntityLabel,
  Relationship,
  TranscriptSpan,
} from "../shared/types.js";
import type {
  EntityMention,
  PersistedEntities,
} from "../entities/index.js";
import type { PersistedRelations } from "../relations/index.js";
import { type AliasMap, resolveKey } from "./canonicalize.js";

function entityIdFor(
  label: string,
  canonical: string,
  aliases?: AliasMap,
): string {
  const raw = `${label}:${canonical.trim().toLowerCase()}`;
  return aliases ? resolveKey(raw, aliases) : raw;
}

function mentionToSpan(m: EntityMention): TranscriptSpan {
  return {
    transcriptId: m.span.transcriptId,
    charStart: m.span.charStart,
    charEnd: m.span.charEnd,
    timeStart: m.span.timeStart,
    timeEnd: m.span.timeEnd,
  };
}

// Convert a PersistedEntities payload into graph-ready Entity records
// plus a mention-id → entity-id map so the relation adapter can
// rewrite endpoints.
export function persistedEntitiesToGraph(
  persisted: PersistedEntities,
  aliases?: AliasMap,
): {
  entities: Entity[];
  mentionToEntityId: Map<string, string>;
} {
  const byId = new Map<string, Entity>();
  const mentionToEntityId = new Map<string, string>();
  for (const m of persisted.mentions) {
    const id = entityIdFor(m.label, m.canonical, aliases);
    mentionToEntityId.set(m.id, id);
    const existing = byId.get(id);
    const span = mentionToSpan(m);
    if (existing) {
      existing.mentions.push(span);
      if (
        m.surface &&
        m.surface !== m.canonical &&
        !existing.aliases.includes(m.surface)
      ) {
        existing.aliases.push(m.surface);
      }
    } else {
      byId.set(id, {
        id,
        type: m.label as EntityLabel,
        canonical: m.canonical,
        aliases:
          m.surface && m.surface !== m.canonical ? [m.surface] : [],
        mentions: [span],
      });
    }
  }
  return { entities: [...byId.values()], mentionToEntityId };
}

// Convert a PersistedRelations payload into graph-ready Relationship
// records. Drops any edge whose endpoints don't resolve in the
// mention-id map — this preserves the evidence invariant.
export function persistedRelationsToGraph(
  persisted: PersistedRelations,
  mentionToEntityId: Map<string, string>,
): Relationship[] {
  const out: Relationship[] = [];
  for (const e of persisted.edges) {
    const subjectId = mentionToEntityId.get(e.subjectMentionId);
    const objectId = mentionToEntityId.get(e.objectMentionId);
    if (!subjectId || !objectId) continue;
    if (subjectId === objectId) continue;
    try {
      out.push(
        createRelationship({
          subjectId,
          predicate: e.predicate as Relationship["predicate"],
          objectId,
          evidence: e.evidence,
          confidence: e.score,
          provenance: "nlp",
        }),
      );
    } catch {
      // Malformed evidence span — skip rather than crash.
      continue;
    }
  }
  return out;
}

// Convenience: adapt both persisted payloads in one call. Accepts null
// for either side and returns empty arrays in that case, which is the
// behaviour the UI server and indexes stage want.
export function neuralToGraph(
  persistedEntities: PersistedEntities | null,
  persistedRelations: PersistedRelations | null,
  aliases?: AliasMap,
): { entities: Entity[]; relationships: Relationship[] } {
  if (!persistedEntities) {
    return { entities: [], relationships: [] };
  }
  const { entities, mentionToEntityId } = persistedEntitiesToGraph(
    persistedEntities,
    aliases,
  );
  const relationships = persistedRelations
    ? persistedRelationsToGraph(persistedRelations, mentionToEntityId)
    : [];
  return { entities, relationships };
}
