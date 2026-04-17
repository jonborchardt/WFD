// Intra-transcript canonicalization.
//
// The old src/nlp/canonicalize.ts leaned on a curated gazetteer and a
// hand-maintained alias map. This version has no curated lists: within a
// single transcript, mentions with the same (label, normalized surface)
// are grouped, and the longest or most-frequent full form becomes the
// canonical for the cluster. That way "Dan" binds to "Dan Brown" inside
// one video without anyone writing a rule for it.
//
// Cross-transcript merging ("US" == "United States" across videos) is the
// graph stage's job and intentionally not done here.

import { EntityLabel, EntityMention, GlinerRawMention, Transcript } from "./types.js";
import { Flattened, makeSpan } from "./flatten.js";

// Normalized key used for intra-transcript clustering. Lowercase, collapse
// internal whitespace, strip leading/trailing punctuation. Deliberately
// simple — we want recall for "the FBI" vs "FBI", not locale-aware NFKC.
function normalize(surface: string): string {
  let s = surface.toLowerCase();
  let start = 0;
  let end = s.length;
  while (start < end && !isWordChar(s.charCodeAt(start))) start++;
  while (end > start && !isWordChar(s.charCodeAt(end - 1))) end--;
  s = s.slice(start, end);
  let collapsed = "";
  let prevWs = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ws = c === 32 || c === 9 || c === 10 || c === 13 || c === 160;
    if (ws) {
      if (!prevWs && collapsed.length > 0) collapsed += " ";
      prevWs = true;
    } else {
      collapsed += s[i];
      prevWs = false;
    }
  }
  return collapsed;
}

function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||   // 0-9
    (code >= 65 && code <= 90) ||   // A-Z
    (code >= 97 && code <= 122) ||  // a-z
    code === 95                     // _
  );
}

// Zero-shot GLiNER occasionally returns pronouns and short function
// words tagged as "person" because the label list is defined by natural
// language and the model's decision boundary is fuzzy. These surfaces
// are never meaningful entities in this corpus, so we drop them before
// canonicalization. Keep this list conservative — only exact matches,
// case-insensitive, no partial-word matching.
const PRONOUN_STOPWORDS = new Set<string>([
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "it", "its", "itself",
  "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what",
  // contractions
  "i'm", "you're", "he's", "she's", "we're", "they're", "it's",
  "i've", "you've", "we've", "they've",
  "i'd", "you'd", "he'd", "she'd", "we'd", "they'd",
  "i'll", "you'll", "he'll", "she'll", "we'll", "they'll",
  // one/ones, someone, anyone, everyone — generic
  "one", "ones", "someone", "anyone", "everyone", "nobody",
  "thing", "things", "something", "anything", "everything",
]);

function isPronounOrGeneric(normalized: string): boolean {
  return PRONOUN_STOPWORDS.has(normalized);
}

// Pick a canonical form for a cluster of surface strings sharing a
// normalized key: prefer the longest form (it's usually the fullest name),
// break ties by frequency.
function pickCanonical(surfaces: string[]): string {
  const counts = new Map<string, number>();
  for (const s of surfaces) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best = surfaces[0];
  let bestScore = -1;
  for (const [surface, count] of counts) {
    const score = surface.length * 1000 + count;
    if (score > bestScore) {
      bestScore = score;
      best = surface;
    }
  }
  return best;
}

// Convert raw GLiNER mentions into typed, canonicalized EntityMention
// objects with proper transcript spans. Drops mentions whose label is not
// in the allowed set (defensive — GLiNER occasionally returns labels we
// did not ask for if the backend is misconfigured).
export function canonicalize(
  raw: GlinerRawMention[],
  allowedLabels: ReadonlyArray<EntityLabel>,
  transcript: Transcript,
  flat: Flattened,
): EntityMention[] {
  const allowed = new Set<string>(allowedLabels);
  const filtered = raw.filter((m) => {
    if (!allowed.has(m.label)) return false;
    // Drop pronouns and generic function words misidentified as
    // entities — overwhelmingly noise in this corpus.
    if (isPronounOrGeneric(normalize(m.text))) return false;
    // Drop single-character surfaces (GLiNER occasionally returns these).
    if (m.text.trim().length < 2) return false;
    return true;
  });

  // Group by (label, normalized surface) → list of surface strings.
  const groups = new Map<string, string[]>();
  for (const m of filtered) {
    const key = `${m.label}::${normalize(m.text)}`;
    const arr = groups.get(key) ?? [];
    arr.push(m.text);
    groups.set(key, arr);
  }
  const canonicalFor = new Map<string, string>();
  for (const [key, surfaces] of groups) {
    canonicalFor.set(key, pickCanonical(surfaces));
  }

  // Build the final mentions with stable ids.
  const out: EntityMention[] = [];
  let idx = 0;
  for (const m of filtered) {
    const key = `${m.label}::${normalize(m.text)}`;
    const canonical = canonicalFor.get(key) ?? m.text;
    out.push({
      id: `m_${String(++idx).padStart(4, "0")}`,
      label: m.label as EntityLabel,
      surface: m.text,
      canonical,
      span: makeSpan(transcript, flat.cueStarts, m.start, m.end),
      score: m.score,
    });
  }
  return out;
}
