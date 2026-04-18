// Given a GLiNER date_time mention, emit zero or more derived mentions
// (time_of_day / specific_date_time / specific_week / specific_month /
// year / decade). Every derived mention reuses the source span so it
// still points back at a transcript anchor.

import type { EntityMention } from "../entities/types.js";
import { parseDateTime, timeOfDayFromHour, type ParsedDateTime } from "./parse.js";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Sunday-start-of-week for a (y,m,d) date. Uses UTC to avoid DST drift.
function sundayOfWeek(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

export interface DerivationValues {
  timeOfDay?: string;
  specificDateTime?: string;
  specificWeek?: string;
  specificMonth?: string;
  year?: string;
  decade?: string;
}

// Pure function from parsed surface to canonical derived values.
// Exposed separately from the mention-emit helper so it's easy to test.
export function derivationsFor(parsed: ParsedDateTime): DerivationValues {
  const out: DerivationValues = {};

  if (parsed.bareTimeOfDay) {
    out.timeOfDay = parsed.bareTimeOfDay;
  }
  if (parsed.time) {
    out.timeOfDay = timeOfDayFromHour(parsed.time.h);
  }

  if (parsed.date) {
    const { y, m, d } = parsed.date;
    if (parsed.time) {
      out.specificDateTime = `${isoDate(y, m, d)}T${pad2(parsed.time.h)}:${pad2(parsed.time.min)}`;
    }
    out.specificWeek = sundayOfWeek(y, m, d);
    out.specificMonth = `${y}-${pad2(m)}`;
    out.year = `${y}`;
    out.decade = decadeLabel(y);
  } else if (parsed.monthOnly) {
    const { y, m } = parsed.monthOnly;
    out.specificMonth = `${y}-${pad2(m)}`;
    out.year = `${y}`;
    out.decade = decadeLabel(y);
  } else if (parsed.yearOnly !== undefined) {
    out.year = `${parsed.yearOnly}`;
    out.decade = decadeLabel(parsed.yearOnly);
  } else if (parsed.decadeOnly !== undefined) {
    out.decade = decadeLabel(parsed.decadeOnly);
  }

  return out;
}

interface DerivedMentionRow {
  label: EntityMention["label"];
  canonical: string;
}

function rowsFor(d: DerivationValues): DerivedMentionRow[] {
  const out: DerivedMentionRow[] = [];
  if (d.timeOfDay) out.push({ label: "time_of_day", canonical: d.timeOfDay });
  if (d.specificDateTime) out.push({ label: "specific_date_time", canonical: d.specificDateTime });
  if (d.specificWeek) out.push({ label: "specific_week", canonical: d.specificWeek });
  if (d.specificMonth) out.push({ label: "specific_month", canonical: d.specificMonth });
  if (d.year) out.push({ label: "year", canonical: d.year });
  if (d.decade) out.push({ label: "decade", canonical: d.decade });
  return out;
}

// Emit derived mentions for one source date_time mention. Mention ids
// are assigned by the caller to keep them stable & sequential across
// the full derived-dates file.
export function deriveMentions(
  source: EntityMention,
  nextId: () => string,
): EntityMention[] {
  if (source.label !== "date_time") return [];
  const parsed = parseDateTime(source.surface);
  if (!parsed) return [];
  const rows = rowsFor(derivationsFor(parsed));
  return rows.map((r) => ({
    id: nextId(),
    label: r.label,
    surface: r.canonical,
    canonical: r.canonical,
    span: { ...source.span },
    score: 1,
    derivedFrom: source.id,
  }));
}
