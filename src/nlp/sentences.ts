// Sentence segmentation over flattened transcript text.
//
// Why this exists: the relationship extractor used to pair entities within a
// single YouTube cue (~3 seconds of speech), which chops sentences in half
// and kills recall for anything that spans a cue boundary. Segmenting the
// flattened text into sentences lets the extractor pair entities within a
// real clause.
//
// Implementation: a hand-rolled splitter that honors a small abbreviation
// list so "Mr. Smith" is not cut after "Mr.", plus newline fallthrough for
// cue-boundary separators. Kept deliberately simple — we tried wink-nlp here
// but its sentence API emits token indices, not character offsets, which
// would force a second mapping pass for no quality gain on this corpus.

export interface SentenceSpan {
  start: number;
  end: number;
}

const ABBREV = new Set([
  "mr", "mrs", "ms", "dr", "sen", "rep", "gov", "pres",
  "st", "jr", "sr", "vs", "etc", "inc", "co", "ltd",
]);

export function segmentSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "\n") continue;

    if (ch === ".") {
      let j = i - 1;
      while (j >= 0 && /[a-zA-Z]/.test(text[j])) j--;
      const word = text.slice(j + 1, i).toLowerCase();
      if (ABBREV.has(word)) continue;
    }

    const next = text[i + 1];
    const isBoundary = ch === "\n" || next === undefined || /\s/.test(next);
    if (!isBoundary) continue;

    const end = i + 1;
    if (end > start) {
      const slice = text.slice(start, end);
      if (slice.trim().length > 0) out.push({ start, end });
    }
    let k = end;
    while (k < text.length && /\s/.test(text[k])) k++;
    start = k;
    i = k - 1;
  }
  if (start < text.length) {
    const slice = text.slice(start, text.length);
    if (slice.trim().length > 0) out.push({ start, end: text.length });
  }
  return out;
}
