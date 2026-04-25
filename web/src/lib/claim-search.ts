// Shared "topic" matcher used by /claims filters. Matches the query
// against entity canonicals and claim kind so plain-text searches like
// "cia" or "speculative" work without explicit tagging.

import type { ClaimsIndexEntry } from "../types";

export function matchesTopic(c: ClaimsIndexEntry, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  for (const e of c.entities) {
    const colon = e.indexOf(":");
    const canonical = colon >= 0 ? e.slice(colon + 1) : e;
    if (canonical.toLowerCase().includes(q)) return true;
    // Also match the label itself so "person" or "organization" works.
    if (colon >= 0 && e.slice(0, colon).toLowerCase().includes(q)) return true;
  }

  if (c.kind.toLowerCase().includes(q)) return true;
  return false;
}
