// Flatten a transcript's cues into one contiguous text buffer and a
// parallel array of char offsets so we can rebase model char-spans into
// (cue, time) coordinates. Kept separate from the GLiNER wrapper so tests
// and the coref path can share it without pulling model code.

import { Transcript, EntitySpan } from "./types.js";

export interface Flattened {
  text: string;
  cueStarts: number[]; // char offset of each cue in the flattened text
}

export function flatten(transcript: Transcript): Flattened {
  const parts: string[] = [];
  const cueStarts: number[] = [];
  let offset = 0;
  for (const cue of transcript.cues) {
    cueStarts.push(offset);
    parts.push(cue.text);
    offset += cue.text.length + 1; // +1 for the newline separator
  }
  return { text: parts.join("\n"), cueStarts };
}

// Largest i with cueStarts[i] <= offset. Binary search.
function cueIndexForOffset(cueStarts: number[], offset: number): number {
  let lo = 0;
  let hi = cueStarts.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cueStarts[mid] <= offset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function makeSpan(
  transcript: Transcript,
  cueStarts: number[],
  charStart: number,
  charEnd: number,
): EntitySpan {
  const startCue = cueIndexForOffset(cueStarts, charStart);
  const endCue = cueIndexForOffset(cueStarts, Math.max(charStart, charEnd - 1));
  const s = transcript.cues[startCue];
  const e = transcript.cues[endCue];
  return {
    transcriptId: transcript.videoId,
    charStart,
    charEnd,
    timeStart: s.start,
    timeEnd: e.start + e.duration,
  };
}
