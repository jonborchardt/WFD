// Which entity types are hidden from UI surfaces (facets, relationship graph,
// search suggestions, per-video entity list). Hidden types are still allowed
// as relationship endpoints — e.g. a "works_for" edge can point at a quantity.
//
// Source of truth: `config/entity-labels.json` (any entry with `hidden: true`).
// This file mirrors that config statically so the Vite build doesn't have to
// reach outside the web/ project. If you add a new hidden label there, update
// this set too.

export const HIDDEN_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "quantity",
  // `date_time` is the raw GLiNER extraction; the date-normalize stage
  // projects it into the derived types below (year, decade, etc), which
  // are the ones users actually filter on. Hiding the raw form avoids a
  // noisy duplicate facet.
  "date_time",
]);

export function isVisibleType(type: string): boolean {
  return !HIDDEN_ENTITY_TYPES.has(type);
}
