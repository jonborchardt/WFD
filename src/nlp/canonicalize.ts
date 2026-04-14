// Post-process NER mentions so the graph merge is sane.
//
// Three concerns:
//
//   1. PERSON_STOPWORDS  — BERT-NER trained on CoNLL-2003 news wire fires
//      `PER` on words like "God", "Lord", "Dad" in conspiracy/interview
//      corpora where they appear constantly. Drop them entirely.
//
//   2. Per-transcript long-form binding — "Dan" alone is a first name that
//      normalize() would otherwise collapse across every unrelated transcript
//      into a single global `person:dan` entity. Bind each short mention to
//      a multi-token mention from the same transcript when exactly one
//      multi-token candidate shares a token with it. Unbound short mentions
//      are scoped to the transcript so they do not merge across videos.
//
//   3. LOCATION_ALIASES  — small hand-maintained map that collapses US /
//      USA / United States / America into one entity, etc. The same
//      treatment for organizations would be nice but the long tail there is
//      too unbounded; start with locations where the list is short.
//
// The entry point canonicalizeNerMentions() takes a NerMention[] plus the
// transcriptId and returns a new filtered + rewritten list. The original
// mentions are not mutated.

import type { NerMention } from "./ner.js";

const PERSON_STOPWORDS = new Set<string>([
  "god",
  "lord",
  "jesus",
  "christ",
  "allah",
  "buddha",
  "satan",
  "devil",
  "dad",
  "mom",
  "mum",
  "mama",
  "papa",
  "father",
  "mother",
  "son",
  "daughter",
  "brother",
  "sister",
  "uncle",
  "aunt",
  "grandma",
  "grandpa",
  "grandfather",
  "grandmother",
  "sir",
  "mister",
  "madam",
  "ma'am",
  "doc",
  "doctor",
  "professor",
  "senator",
  "congressman",
  "congresswoman",
  "president",
  "mr",
  "mrs",
  "ms",
  "dr",
]);

// Canonical location → list of surface forms that should merge into it.
// Keys are the canonical form; values are aliases compared case-insensitively.
const LOCATION_CANONICALS: Array<[string, string[]]> = [
  [
    "United States",
    [
      "us",
      "u.s.",
      "u.s",
      "usa",
      "u.s.a.",
      "u.s.a",
      "america",
      "the us",
      "the united states",
      "united states of america",
      "the states",
    ],
  ],
  [
    "United Kingdom",
    ["uk", "u.k.", "u.k", "britain", "great britain", "the uk", "england"],
    // England is technically a sub-region but the corpus uses it interchangeably.
  ],
  ["Soviet Union", ["ussr", "u.s.s.r.", "the soviet union", "soviet russia"]],
  ["European Union", ["eu", "e.u.", "the eu"]],
  ["North Korea", ["dprk", "d.p.r.k.", "north korean"]],
  ["South Korea", ["rok", "south korean"]],
];

// Flattened alias → canonical map built once at module load.
const LOCATION_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of LOCATION_CANONICALS) {
    m.set(canonical.toLowerCase(), canonical);
    for (const a of aliases) m.set(a.toLowerCase(), canonical);
  }
  return m;
})();

function tokens(s: string): string[] {
  return s
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export interface CanonicalizeOptions {
  // When a single-token person cannot be bound to a multi-token mention in
  // the same transcript, scope its canonical form with this suffix so it
  // does not merge across transcripts. Pass the videoId.
  transcriptId: string;
  // Drop single-token persons that never appear as part of a multi-token
  // mention in the transcript. Default false (we keep them scoped instead).
  dropUnboundFirstNames?: boolean;
}

export function canonicalizeNerMentions(
  mentions: NerMention[],
  opts: CanonicalizeOptions,
): NerMention[] {
  const transcriptId = opts.transcriptId;
  const dropUnbound = opts.dropUnboundFirstNames ?? false;

  // Build per-transcript alias map for persons: token (lowercased) → set of
  // multi-token canonical forms that contain it.
  const tokenToLong = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (m.type !== "person") continue;
    const toks = tokens(m.surface);
    if (toks.length < 2) continue;
    const canonicalLong = toks.join(" ");
    for (const t of toks) {
      const key = t.toLowerCase();
      if (PERSON_STOPWORDS.has(key)) continue;
      if (!tokenToLong.has(key)) tokenToLong.set(key, new Set());
      tokenToLong.get(key)!.add(canonicalLong);
    }
  }

  const out: NerMention[] = [];
  for (const m of mentions) {
    if (m.type === "person") {
      const toks = tokens(m.surface);
      // Drop stopword-only mentions (e.g. "God", "Dad").
      if (toks.every((t) => PERSON_STOPWORDS.has(t.toLowerCase()))) continue;
      if (toks.length >= 2) {
        // Multi-token: canonical is just the cleaned surface.
        out.push({ ...m, canonical: toks.join(" ") });
        continue;
      }
      // Single-token: try to bind to a unique multi-token form.
      const key = toks[0].toLowerCase();
      const candidates = tokenToLong.get(key);
      if (candidates && candidates.size === 1) {
        const [long] = [...candidates];
        out.push({ ...m, canonical: long });
        continue;
      }
      if (dropUnbound) continue;
      // Unbound: scope to transcript so it does not merge globally.
      out.push({ ...m, canonical: `${toks[0]} #${transcriptId}` });
      continue;
    }

    if (m.type === "location") {
      const canonical = LOCATION_ALIAS.get(m.surface.trim().toLowerCase());
      if (canonical) {
        out.push({ ...m, canonical });
        continue;
      }
      out.push({ ...m });
      continue;
    }

    // Organizations: pass through unchanged. Long-tail aliasing left for
    // a future pass once the corpus shows which ones matter.
    out.push({ ...m });
  }
  return out;
}
