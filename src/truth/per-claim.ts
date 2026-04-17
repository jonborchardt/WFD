// Per-claim truthiness.
//
// Many of the corpus transcripts end with a "verdict" or "summary" section
// where the speaker/editor asserts which claims in the video are true,
// false, or uncertain. We detect that region, extract labeled claims, and
// attach the judgment to any relationship whose evidence overlaps with (or
// lexically matches) the claim.

import { Relationship } from "../shared/types.js";
import type { Transcript } from "../entities/index.js";
import { GraphStore } from "../graph/store.js";

export type Verdict = "true" | "false" | "uncertain";

export interface Claim {
  text: string;
  verdict: Verdict;
  cueIndex: number;
  timeStart: number;
}

const VERDICT_PATTERNS: Array<{ re: RegExp; verdict: Verdict }> = [
  { re: /\b(?:true|confirmed|verified|accurate|correct)\b/i, verdict: "true" },
  { re: /\b(?:false|debunked|wrong|incorrect|misleading|inaccurate)\b/i, verdict: "false" },
  { re: /\b(?:unclear|unverified|inconclusive|uncertain|disputed)\b/i, verdict: "uncertain" },
];

// Heuristic: the verdict region is whichever suffix of the transcript contains
// a "summary" / "verdict" / "fact check" marker. If nothing matches, we fall
// back to the last 15% of cues.
export function detectVerdictRegion(transcript: Transcript): {
  startCueIndex: number;
} {
  const markers =
    /\b(verdict|summary|fact[- ]check|in conclusion|to sum up|final|recap)\b/i;
  for (let i = 0; i < transcript.cues.length; i++) {
    if (markers.test(transcript.cues[i].text)) return { startCueIndex: i };
  }
  return {
    startCueIndex: Math.floor(transcript.cues.length * 0.85),
  };
}

export function extractClaims(transcript: Transcript): Claim[] {
  const { startCueIndex } = detectVerdictRegion(transcript);
  const out: Claim[] = [];
  for (let i = startCueIndex; i < transcript.cues.length; i++) {
    const cue = transcript.cues[i];
    for (const pat of VERDICT_PATTERNS) {
      if (pat.re.test(cue.text)) {
        out.push({
          text: cue.text,
          verdict: pat.verdict,
          cueIndex: i,
          timeStart: cue.start,
        });
        break;
      }
    }
  }
  return out;
}

function verdictScore(v: Verdict): number {
  if (v === "true") return 1;
  if (v === "false") return 0;
  return 0.5;
}

// For each claim, find relationships from the same transcript whose evidence
// cue has lexical overlap with the claim, and stamp them with directTruth.
// The claim text itself becomes secondary evidence (stored via update).
export function attachTruthiness(
  store: GraphStore,
  transcript: Transcript,
  claims: Claim[],
): Relationship[] {
  const updated: Relationship[] = [];
  const rels = store.bySourceTranscript(transcript.videoId);
  for (const claim of claims) {
    const claimTokens = tokenize(claim.text);
    for (const rel of rels) {
      const cueText = findCueTextForRel(transcript, rel);
      if (!cueText) continue;
      const overlap = jaccard(claimTokens, tokenize(cueText));
      if (overlap < 0.15) continue;
      const next = store.updateRelationship(rel.id, {
        directTruth: verdictScore(claim.verdict),
      });
      updated.push(next);
    }
  }
  return updated;
}

function findCueTextForRel(t: Transcript, r: Relationship): string | null {
  let offset = 0;
  for (const cue of t.cues) {
    const end = offset + cue.text.length;
    if (r.evidence.charStart >= offset && r.evidence.charStart <= end) {
      return cue.text;
    }
    offset = end + 1;
  }
  return null;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}
