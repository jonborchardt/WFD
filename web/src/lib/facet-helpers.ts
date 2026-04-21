// Shared helpers used by the faceted /claims and /contradictions
// pages. Keeping them in one place so the two pages don't drift on
// parsing / formatting / entity-type conventions.

// Prefixes the entity-card ordering in the rail. Types not listed
// fall through to the end in discovery order.
export const ENTITY_PRIORITY = [
  "person", "organization", "location",
  "event", "thing", "topic", "misc",
];

export const ENTITY_TYPE_COLOR: Record<string, string> = {
  person: "#90caf9",
  organization: "#ce93d8",
  location: "#a5d6a7",
  event: "#ffb74d",
  thing: "#80deea",
  topic: "#80deea",
  misc: "#b0bec5",
};

// Cap on claim IDs sent to the claim-graph via a "graph these" button.
// The graph degrades quickly past a few hundred nodes once dependency
// and contradiction edges expand around each seed; 60 keeps the
// result readable and the URL under 2 KB.
export const GRAPH_SEED_CAP = 60;

// Split an entity key like "person:dan brown" into its type prefix
// and canonical. Returns { type: "unknown" } if the string has no
// colon (shouldn't happen in well-formed data).
export function splitEntityKey(key: string): { type: string; canonical: string } {
  const i = key.indexOf(":");
  if (i < 0) return { type: "unknown", canonical: key };
  return { type: key.slice(0, i), canonical: key.slice(i + 1) };
}

// ── numeric range round-tripping ──────────────────────────────────
// Used for 0..1 facets (truth, confidence, similarity) and integer
// facets (shared-entity count). Two floats separated by a dash.

export function rangeStr(r: [number, number] | null): string {
  if (!r) return "";
  return `${r[0].toFixed(2)}-${r[1].toFixed(2)}`;
}

export function parseRange(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2])];
}

// ── date range round-tripping ─────────────────────────────────────
// Serialized as `YYYY-MM-DD..YYYY-MM-DD`. Day granularity matches the
// day-month-year labels on the DateBrushFacet axis.

export function fmtDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateRangeStr(r: [number, number]): string {
  return `${fmtDay(r[0])}..${fmtDay(r[1])}`;
}

export function parseDateRange(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const lo = Date.parse(m[1] + "T00:00:00Z");
  const hi = Date.parse(m[2] + "T23:59:59Z");
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return [lo, hi];
}
