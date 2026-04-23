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

// Predicate → allowed argument label sets. Post-processing pass over
// GLiREL output drops edges whose endpoint types don't match. This is
// corrective-only (applied at adapter read-time against raw per-video
// relations files), not a GLiREL re-run. Origin: plan3 A6 — 204
// `located_in` edges had a date_time as subject, 839 `member_of`
// edges had a person as object, 47 `authored` edges had a date as
// subject, etc. Entries omitted for predicates where no clear
// type-constraint holds (said/believes/endorses/denies/caused/…).
type LabelSet = ReadonlySet<string>;
const PERSON_OR_ORG: LabelSet = new Set(["person", "organization", "group_or_movement"]);
const LOCATION_LIKE: LabelSet = new Set(["location", "facility"]);
const PERSON: LabelSet = new Set(["person"]);
const ORG_LIKE: LabelSet = new Set(["organization", "group_or_movement"]);
const PLACE_OR_TIME: LabelSet = new Set(["location", "facility", "date_time"]);
const ANY_LABELS: LabelSet = new Set([
  "person", "organization", "location", "facility", "event",
  "work_of_media", "technology", "date_time", "quantity",
  "nationality_or_ethnicity", "group_or_movement", "ideology", "role",
  "law_or_policy", "time_of_day", "specific_date_time", "specific_week",
]);

interface ArgSchema { subject: LabelSet; object: LabelSet }
const PREDICATE_SCHEMA: Record<string, ArgSchema> = {
  located_in:       { subject: new Set(["person","organization","location","facility","event","group_or_movement"]),    object: LOCATION_LIKE },
  member_of:        { subject: new Set(["person","organization"]),                                                       object: ORG_LIKE },
  part_of:          { subject: new Set(["organization","location","facility","work_of_media","technology","group_or_movement"]), object: new Set(["organization","location","facility","work_of_media","technology","event","group_or_movement"]) },
  authored:         { subject: PERSON_OR_ORG,                                                                            object: new Set(["work_of_media"]) },
  published:        { subject: PERSON_OR_ORG,                                                                            object: new Set(["work_of_media"]) },
  founded:          { subject: new Set(["person","organization"]),                                                       object: new Set(["organization","group_or_movement","facility"]) },
  works_for:        { subject: PERSON,                                                                                    object: ORG_LIKE },
  led_by:           { subject: new Set(["organization","group_or_movement","event"]),                                   object: PERSON },
  born_in:          { subject: PERSON,                                                                                    object: PLACE_OR_TIME },
  died_in:          { subject: PERSON,                                                                                    object: PLACE_OR_TIME },
  operates_in:      { subject: new Set(["person","organization","facility"]),                                            object: LOCATION_LIKE },
  met_with:         { subject: PERSON_OR_ORG,                                                                            object: PERSON_OR_ORG },
  allied_with:      { subject: PERSON_OR_ORG,                                                                            object: PERSON_OR_ORG },
  opposed_by:       { subject: ANY_LABELS,                                                                                object: PERSON_OR_ORG },
  funded_by:        { subject: ANY_LABELS,                                                                                object: PERSON_OR_ORG },
  investigated_by:  { subject: ANY_LABELS,                                                                                object: PERSON_OR_ORG },
  prosecuted_by:    { subject: PERSON_OR_ORG,                                                                            object: PERSON_OR_ORG },
  convicted_of:     { subject: PERSON,                                                                                    object: new Set(["event","role"]) },
  created:          { subject: PERSON_OR_ORG,                                                                            object: new Set(["work_of_media","technology","organization","facility"]) },
  occurred_on:      { subject: new Set(["event"]),                                                                        object: new Set(["date_time","specific_date_time","specific_week","time_of_day"]) },
};

function labelOf(entityId: string): string | null {
  const idx = entityId.indexOf(":");
  if (idx <= 0) return null;
  return entityId.slice(0, idx);
}

function edgePassesTypeCheck(predicate: string, subjectId: string, objectId: string): boolean {
  const schema = PREDICATE_SCHEMA[predicate];
  if (!schema) return true;
  const sLabel = labelOf(subjectId);
  const oLabel = labelOf(objectId);
  if (!sLabel || !oLabel) return true;
  return schema.subject.has(sLabel) && schema.object.has(oLabel);
}

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
    if (!edgePassesTypeCheck(e.predicate, subjectId, objectId)) continue;
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
