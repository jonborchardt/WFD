// Deterministic stand-in for the neural NER module, used by entity/coref/
// relationship tests that would otherwise need to download the real BERT
// model. Produces NerMention[] from title-cased proper noun sequences —
// sufficient for the properly-cased fixtures used in tests.
//
// This helper is NOT used in production. The real extractor calls
// src/nlp/ner.ts → runNer().

import type { NerMention } from "../../src/nlp/ner.ts";

const KNOWN_ORGS = ["NASA", "FBI", "OpenAI", "Anthropic", "Google"];
const KNOWN_LOCS = [
  "Berlin",
  "Paris",
  "London",
  "Washington",
  "Moscow",
  "Beijing",
];

export function synthesizeNer(text: string): NerMention[] {
  const out: NerMention[] = [];
  // Persons: 2+ consecutive capitalized words.
  const personRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  let m: RegExpExecArray | null;
  while ((m = personRe.exec(text))) {
    const surface = m[0];
    // Skip if it's a known org/location.
    if (KNOWN_ORGS.includes(surface) || KNOWN_LOCS.includes(surface)) continue;
    out.push({
      type: "person",
      surface,
      start: m.index,
      end: m.index + surface.length,
      score: 0.99,
    });
  }
  for (const org of KNOWN_ORGS) addAll(out, text, org, "organization");
  for (const loc of KNOWN_LOCS) addAll(out, text, loc, "location");
  return out.sort((a, b) => a.start - b.start);
}

function addAll(
  out: NerMention[],
  text: string,
  term: string,
  type: NerMention["type"],
): void {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      type,
      surface: m[0],
      start: m.index,
      end: m.index + m[0].length,
      score: 0.99,
    });
  }
}
