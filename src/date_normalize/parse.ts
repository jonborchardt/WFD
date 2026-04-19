// Surface-form date/time parser for the date-normalize stage.
//
// Input is the `surface` of a GLiNER date_time mention — short strings
// like "1925", "the 1970s", "January 6, 2021", "1/1/2021 4pm", "3p",
// "tonight". Output is a structured ParsedDateTime, or null when the
// surface looks like a date_time mention we cannot interpret.
//
// No timezone handling — times are treated as naive wall-clock.

export type TimeBucket = "morning" | "day" | "evening" | "night";

export interface ParsedDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export interface ParsedTime {
  h: number;   // 0-23
  min: number; // 0-59
}

export interface ParsedDateTime {
  date?: ParsedDate;           // full Y/M/D known
  time?: ParsedTime;           // wall-clock time known
  yearOnly?: number;           // bare year, no month/day
  monthOnly?: { y: number; m: number }; // month + year, no day
  decadeOnly?: number;         // bare decade like 1970 for "1970s"
  bareTimeOfDay?: TimeBucket;  // surface was a pure word like "morning"
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const WORD_TIME_OF_DAY: Record<string, TimeBucket> = {
  morning: "morning",
  dawn: "morning",
  sunrise: "morning",
  afternoon: "day",
  midday: "day",
  noon: "day",
  evening: "evening",
  dusk: "evening",
  sunset: "evening",
  tonight: "evening",
  night: "night",
  midnight: "night",
  overnight: "night",
};

// Normalize surface: lowercase, collapse whitespace, strip leading "the ".
function normalize(surface: string): string {
  return surface
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^the\s+/, "")
    .trim();
}

// 12-hour time like "4p", "4pm", "4:30 p.m.", "12:00am". Returns {h,min}
// in 24-hour form or null.
function parseClockTime(s: string): ParsedTime | null {
  const m = s.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)$/,
  );
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 1 || h > 12 || min > 59) return null;
  const isPm = m[3].startsWith("p");
  if (h === 12) h = 0;
  if (isPm) h += 12;
  return { h, min };
}

// Map 0-23 to a time-of-day bucket.
// morning: 5-11, day: 12-16, evening: 17-20, night: 21-04.
export function timeOfDayFromHour(h: number): TimeBucket {
  if (h >= 5 && h <= 11) return "morning";
  if (h >= 12 && h <= 16) return "day";
  if (h >= 17 && h <= 20) return "evening";
  return "night";
}

// Two-digit year → four-digit. YY<50 → 20YY, else 19YY.
function expandYy(yy: number): number {
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

// Try to parse just a clock time. "3p" / "4:30 pm" / "noon" / "midnight".
function tryTimeOnly(s: string): ParsedDateTime | null {
  if (s in WORD_TIME_OF_DAY) {
    if (s === "noon") return { time: { h: 12, min: 0 } };
    if (s === "midnight") return { time: { h: 0, min: 0 } };
    return { bareTimeOfDay: WORD_TIME_OF_DAY[s] };
  }
  const t = parseClockTime(s);
  if (t) return { time: t };
  return null;
}

// "1970s", "'70s", "70s" → decade start year.
function tryDecade(s: string): number | null {
  let m = s.match(/^(\d{4})s$/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y % 10 !== 0) return null;
    return y;
  }
  m = s.match(/^'?(\d{2})s$/);
  if (m) {
    const yy = parseInt(m[1], 10);
    if (yy % 10 !== 0) return null;
    return expandYy(yy);
  }
  return null;
}

// Bare 4-digit year, e.g. "1925".
function tryYearOnly(s: string): number | null {
  if (!/^\d{4}$/.test(s)) return null;
  const y = parseInt(s, 10);
  if (y < 1000 || y > 2999) return null;
  return y;
}

// "january 2021" / "jan 2021".
function tryMonthYear(s: string): { y: number; m: number } | null {
  const m = s.match(/^([a-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTH_NAMES[m[1]];
  if (!mon) return null;
  const y = parseInt(m[2], 10);
  if (y < 1000 || y > 2999) return null;
  return { y, m: mon };
}

// Numeric date: M/D/YYYY, M/D/YY, M-D-YYYY, YYYY-MM-DD.
function tryNumericDate(s: string): ParsedDate | null {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return normalizeDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    const mo = +m[1];
    const d = +m[2];
    let y = +m[3];
    if (m[3].length === 2) y = expandYy(y);
    return normalizeDate(y, mo, d);
  }
  return null;
}

// "january 6, 2021" / "jan 6 2021" / "january 6th 2021".
function tryWordDate(s: string): ParsedDate | null {
  const m = s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTH_NAMES[m[1]];
  if (!mon) return null;
  return normalizeDate(+m[3], mon, +m[2]);
}

function normalizeDate(y: number, m: number, d: number): ParsedDate | null {
  if (y < 1000 || y > 2999) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m, d };
}

// Split a normalized surface into a date chunk and an optional time
// chunk. Accepts "1/1/2021 4pm", "jan 6 2021 4:30 p.m.", or just the
// date half. Returns [datePart, timePart|null].
function splitDateAndTime(s: string): [string, string | null] {
  // Look for a trailing clock-time token. Anchor on "am/pm/a.m./p.m." so
  // we don't greedily eat part of a date.
  const m = s.match(
    /^(.*?)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?))$/,
  );
  if (m) return [m[1].trim(), m[2].replace(/\s+/g, "")];
  return [s, null];
}

export function parseDateTime(surface: string): ParsedDateTime | null {
  const raw = normalize(surface);
  if (!raw) return null;

  // Time-only cases first.
  const timeOnly = tryTimeOnly(raw);
  if (timeOnly) return timeOnly;

  // Decade-only.
  const dec = tryDecade(raw);
  if (dec !== null) return { decadeOnly: dec };

  // Year-only.
  const yy = tryYearOnly(raw);
  if (yy !== null) return { yearOnly: yy };

  // Month + year.
  const my = tryMonthYear(raw);
  if (my) return { monthOnly: my };

  // Full date, optionally followed by time.
  const [datePart, timePart] = splitDateAndTime(raw);
  const date = tryNumericDate(datePart) ?? tryWordDate(datePart);
  if (date) {
    const out: ParsedDateTime = { date };
    if (timePart) {
      const t = parseClockTime(timePart);
      if (t) out.time = t;
    }
    return out;
  }

  return null;
}
