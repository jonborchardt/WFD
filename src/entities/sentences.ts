// Sentence segmentation — regex-free.
//
// The old src/nlp/sentences.ts used two tiny inline regex character tests
// (/[a-zA-Z]/ and /\s/). This module is part of the "kill all regex" cut,
// so the same logic is implemented with char-code comparisons. Same
// behavior, no RegExp allocations.
//
// Segmentation rule: split on `.`, `!`, `?`, or newline when the next
// character is whitespace or end-of-text. Suppresses splits after a known
// abbreviation ("Mr.", "Dr.", "Sen.", ...).

export interface SentenceSpan {
  start: number;
  end: number;
}

const ABBREV = new Set([
  "mr", "mrs", "ms", "dr", "sen", "rep", "gov", "pres",
  "st", "jr", "sr", "vs", "etc", "inc", "co", "ltd",
]);

function isAsciiLetter(ch: string): boolean {
  if (ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isWhitespace(ch: string): boolean {
  if (ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  // space, tab, LF, CR, VT, FF, NBSP
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 160;
}

export function segmentSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "\n") continue;

    if (ch === ".") {
      let j = i - 1;
      while (j >= 0 && isAsciiLetter(text[j])) j--;
      const word = text.slice(j + 1, i).toLowerCase();
      if (ABBREV.has(word)) continue;
    }

    const next = text[i + 1];
    const isBoundary = ch === "\n" || next === undefined || isWhitespace(next);
    if (!isBoundary) continue;

    const end = i + 1;
    if (end > start) {
      const slice = text.slice(start, end);
      if (slice.trim().length > 0) out.push({ start, end });
    }
    let k = end;
    while (k < text.length && isWhitespace(text[k])) k++;
    start = k;
    i = k - 1;
  }
  if (start < text.length) {
    const slice = text.slice(start, text.length);
    if (slice.trim().length > 0) out.push({ start, end: text.length });
  }
  return out;
}
