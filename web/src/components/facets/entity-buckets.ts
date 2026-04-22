// Shared helpers for the per-entity-type facets on /claims and
// /contradictions. Both pages need the same two things:
//
//   1. count how many entities of each type survive the filter,
//      scoped per type so selecting a location narrows the
//      organizations facet but not itself; and
//   2. build a chip-strip slot per selected type so the filter
//      chips group OR-within-type AND-between-type.
//
// Both were inlined copies before; this file is the single source.

import { ENTITY_TYPE_COLOR, splitEntityKey } from "../../lib/facet-helpers";
import type { ChipSlot } from "./FilterChipStrip";

export interface EntityBucketValue {
  label: string;
  count: number;
}

/** type → (entityKey → { label, count }) */
export type EntityBuckets = Map<string, Map<string, EntityBucketValue>>;

/**
 * Build per-type entity rows with counts. Keeps a bucket for every
 * type present in `rows` (even when the current filter narrows it
 * to zero) so facet cards don't appear/disappear as the user types.
 *
 * `scopeForType(type)` returns the rows that should be counted for
 * that type — callers pass a function that applies every filter
 * EXCEPT the same-type portion of `filterEntities`. Matches the
 * AND-across / OR-within semantics the pages already use.
 */
export function buildEntityBucketsByType<Row>(
  rows: Row[],
  filterEntities: Set<string>,
  scopeForType: (type: string) => Row[],
  getEntities: (row: Row) => readonly string[] | undefined,
): EntityBuckets {
  const presentTypes = new Set<string>();
  for (const r of rows) {
    const es = getEntities(r);
    if (!es) continue;
    for (const e of es) presentTypes.add(splitEntityKey(e).type);
  }
  // Also surface any type that appears only because the user
  // selected something of that type — otherwise the card for their
  // current selection would vanish until they clear it.
  for (const e of filterEntities) presentTypes.add(splitEntityKey(e).type);

  const out: EntityBuckets = new Map();
  for (const type of presentTypes) {
    const scope = scopeForType(type);
    const bucket = new Map<string, EntityBucketValue>();
    for (const r of scope) {
      const es = getEntities(r);
      if (!es) continue;
      for (const ek of es) {
        const k = splitEntityKey(ek);
        if (k.type !== type) continue;
        const slot = bucket.get(ek) ?? { label: k.canonical, count: 0 };
        slot.count += 1;
        bucket.set(ek, slot);
      }
    }
    out.set(type, bucket);
  }
  return out;
}

/**
 * One ChipSlot per entity type the user has selected. Within a type:
 * OR; between types: AND (handled by the chip strip renderer).
 * Color comes from the shared palette so chips match their BarList
 * bars and FacetCard accents.
 */
export function buildEntityChipSlots(
  filterEntities: Set<string>,
  onClearEntity: (key: string) => void,
): ChipSlot[] {
  if (filterEntities.size === 0) return [];
  const byType = new Map<string, string[]>();
  for (const e of filterEntities) {
    const t = splitEntityKey(e).type;
    const arr = byType.get(t) ?? [];
    arr.push(e);
    byType.set(t, arr);
  }
  const slots: ChipSlot[] = [];
  for (const [type, values] of byType) {
    slots.push({
      key: `entities:${type}`,
      conj: "OR",
      color: ENTITY_TYPE_COLOR[type],
      items: values.map((v) => ({
        id: v,
        label: `${type}: ${splitEntityKey(v).canonical}`,
        onClear: () => onClearEntity(v),
      })),
    });
  }
  return slots;
}

/**
 * Given a page's `filter`, return a new filter object with entity
 * selections of a specific type dropped. Callers pass the result to
 * their `passes()` when computing the per-type scoped counts.
 */
export function stripEntityType<F extends { entities: Set<string> }>(
  filter: F,
  type: string,
): F {
  return {
    ...filter,
    entities: new Set(
      [...filter.entities].filter((e) => splitEntityKey(e).type !== type),
    ),
  };
}
