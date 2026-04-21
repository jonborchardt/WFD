// Shared "topic" matcher used by /claims and /contradictions filters.
//
// The filter historically matched only `claim.tags[]` — but the
// extraction pass that ran before the tags field existed produced zero
// tagged claims, so "cia" returned nothing even though the corpus is
// full of CIA claims. We broaden the match to also accept:
//   - entity canonicals (the part after `label:`)
//   - claim kind
// That way searches work out of the box; explicit tags still win when
// they're populated by re-extraction or admin overrides.

import type { ClaimsIndexEntry } from "../types";

export function matchesTopic(c: ClaimsIndexEntry, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  if ((c.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;

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
