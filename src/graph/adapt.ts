// Adapter layer between the neural extraction output
// (PersistedEntities + PersistedRelations, written by the entities and
// relations stages) and the shared graph types (Entity, Relationship)
// consumed by src/graph/, src/truth/, and the UI server.
//
// The on-disk per-video shapes are:
//   data/entities/<id>.json       → PersistedEntities { mentions[] }
//   data/relations/<id>.json      → PersistedRelations { edges[] }
//   data/date-normalize/<id>.json → PersistedDerivedDates { mentions[] }
//
// The downstream shapes are:
//   Entity       { id, type, canonical, aliases, mentions[] }
//   Relationship { id, subjectId, predicate, objectId, evidence, ... }
//
// Alias application order (per mention):
//   1. Apply per-video alias (video:<vid>:<key> → target) if set
//   2. Resolve corpus merge chain (key → target[, target, ...])
//   3. Drop mention if resolved key is hidden
//   4. Entity.canonical comes from display:<resolvedKey> override
//      when set, otherwise from the extracted canonical
//
// Per edge: drop if its composite del-key is in the alias map.

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
import type { PersistedDerivedDates } from "../date_normalize/types.js";
import {
  entityKeyOf,
  getDisplayOverride,
  getVideoAlias,
  isDeleted,
  isRelationDeleted,
  resolveKey,
  type AliasMap,
} from "./canonicalize.js";

// Resolve a mention's key through (per-video alias?) → corpus merge →
// return the final entity id. `null` means the mention should be
// dropped because its final resolution is hidden.
function resolveMentionKey(
  label: string,
  canonical: string,
  aliases: AliasMap | undefined,
  videoId: string | undefined,
): string | null {
  const raw = entityKeyOf(label, canonical);
  if (!aliases) return raw;
  const afterVideo =
    videoId !== undefined
      ? getVideoAlias(videoId, raw, aliases) ?? raw
      : raw;
  const afterCorpus = resolveKey(afterVideo, aliases);
  if (isDeleted(afterCorpus, aliases)) return null;
  return afterCorpus;
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
// rewrite endpoints. If a derived-dates payload is supplied, its
// mentions are merged in alongside the GLiNER output.
export function persistedEntitiesToGraph(
  persisted: PersistedEntities,
  aliases?: AliasMap,
  derived?: PersistedDerivedDates | null,
  videoId?: string,
): {
  entities: Entity[];
  mentionToEntityId: Map<string, string>;
} {
  const byId = new Map<string, Entity>();
  const mentionToEntityId = new Map<string, string>();
  const vid = videoId ?? persisted.transcriptId;
  const all: EntityMention[] = [...persisted.mentions];
  if (derived) all.push(...derived.mentions);
  for (const m of all) {
    const id = resolveMentionKey(m.label, m.canonical, aliases, vid);
    if (id === null) continue; // hidden
    mentionToEntityId.set(m.id, id);
    const existing = byId.get(id);
    const span = mentionToSpan(m);
    // Prefer a display override if set; otherwise keep the extracted
    // canonical from the first mention (which is the longest/most-
    // frequent form picked by the intra-transcript canonicalizer).
    const displayOverride = aliases
      ? getDisplayOverride(id, aliases)
      : undefined;
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
        canonical: displayOverride ?? m.canonical,
        aliases:
          m.surface && m.surface !== m.canonical ? [m.surface] : [],
        mentions: [span],
      });
    }
  }
  return { entities: [...byId.values()], mentionToEntityId };
}

// Convert a PersistedRelations payload into graph-ready Relationship
// records. Drops any edge whose endpoints don't resolve, whose
// subject == object after aliasing, or whose composite del-key is set
// in the alias map.
export function persistedRelationsToGraph(
  persisted: PersistedRelations,
  mentionToEntityId: Map<string, string>,
  aliases?: AliasMap,
  videoId?: string,
): Relationship[] {
  const out: Relationship[] = [];
  const vid = videoId ?? persisted.transcriptId;
  for (const e of persisted.edges) {
    const subjectId = mentionToEntityId.get(e.subjectMentionId);
    const objectId = mentionToEntityId.get(e.objectMentionId);
    if (!subjectId || !objectId) continue;
    if (subjectId === objectId) continue;
    if (
      aliases &&
      isRelationDeleted(
        vid,
        subjectId,
        e.predicate,
        objectId,
        e.evidence.timeStart,
        aliases,
      )
    ) {
      continue;
    }
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
      continue;
    }
  }
  return out;
}

// Convenience: adapt both persisted payloads in one call.
export function neuralToGraph(
  persistedEntities: PersistedEntities | null,
  persistedRelations: PersistedRelations | null,
  aliases?: AliasMap,
  derivedDates?: PersistedDerivedDates | null,
  videoId?: string,
): { entities: Entity[]; relationships: Relationship[] } {
  if (!persistedEntities) {
    return { entities: [], relationships: [] };
  }
  const { entities, mentionToEntityId } = persistedEntitiesToGraph(
    persistedEntities,
    aliases,
    derivedDates ?? null,
    videoId,
  );
  const relationships = persistedRelations
    ? persistedRelationsToGraph(
        persistedRelations,
        mentionToEntityId,
        aliases,
        videoId,
      )
    : [];
  return { entities, relationships };
}
