// Neural NER via @xenova/transformers, running a BERT model locally in Node.
//
// Shape: one lazy-loaded singleton pipeline per process. runNer(text) chunks
// the input at sentence boundaries (BERT has a ~512 token context), runs the
// model on each chunk, and rebases the returned character spans back into
// the original text.
//
// Output is an array of NerMention objects in the same shape the rest of the
// extractor already consumes, so entities.ts can merge regex/gazetteer and
// neural mentions in one normalize() pass.
//
// Failure mode: if the model can't be loaded (offline first run, disk space,
// Windows quirks), runNer resolves to [] and logs a single warning. The
// regex/gazetteer layers keep producing entities and the pipeline does not
// fail — degradation is graceful.

import { segmentSentences } from "./sentences.js";
import { Entity } from "../shared/types.js";

// Which model to load. `Xenova/bert-base-NER` is a CoNLL-2003 cased BERT
// (PER/ORG/LOC/MISC) hosted on the Hugging Face hub as ONNX, downloaded once
// on first use into the transformers.js cache. Swap in a different model ID
// to change backbones — nothing else in this file needs to change.
const MODEL_ID = "Xenova/bert-base-NER";

// Cap per-chunk character length well under the model's ~512 token window.
// Roughly 3 chars/token is a safe lower bound for English.
const MAX_CHUNK_CHARS = 1200;

export interface NerMention {
  type: Entity["type"]; // "person" | "organization" | "location"
  surface: string;
  start: number; // char offset in the full input text
  end: number; // exclusive
  score: number;
  // Optional canonical form, set by src/nlp/canonicalize.ts after runNer.
  // When present, downstream merging keys on this instead of surface — this
  // is how "Dan" gets bound to "Dan Brown" within a transcript, and how
  // "US"/"America" collapse to "United States".
  canonical?: string;
}

// The transformers.js token-classification pipeline returns one object per
// subword token, labelled with B-/I-/O tags, and does NOT populate char
// offsets. We aggregate subwords into whole-word entity spans ourselves
// (see aggregate() below) and locate char offsets by string search inside
// the current chunk.
interface RawEntity {
  entity_group?: string;
  entity?: string;
  word: string;
  start?: number | null;
  end?: number | null;
  score: number;
  index?: number;
}

interface AggregatedSpan {
  tag: string; // e.g. "PER", "ORG", "LOC"
  word: string; // assembled surface form
  score: number; // min over member tokens
}

type NerPipeline = (
  input: string,
  opts?: Record<string, unknown>,
) => Promise<RawEntity[]>;

let pipelinePromise: Promise<NerPipeline | null> | null = null;

async function loadPipeline(): Promise<NerPipeline | null> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const mod = await import("@xenova/transformers");
      const pipeline = (mod as unknown as {
        pipeline: (task: string, model: string) => Promise<NerPipeline>;
      }).pipeline;
      const pipe = await pipeline("token-classification", MODEL_ID);
      return pipe;
    } catch (err) {
       
      console.warn(
        `[ner] failed to load ${MODEL_ID}; falling back to regex-only extraction:`,
        (err as Error).message,
      );
      return null;
    }
  })();
  return pipelinePromise;
}

export async function isNerAvailable(): Promise<boolean> {
  const p = await loadPipeline();
  return p !== null;
}

// Test hook — lets unit tests inject a fake pipeline so they don't trigger a
// 400MB model download. Pass null to clear.
export function __setNerPipelineForTests(fake: NerPipeline | null): void {
  pipelinePromise = Promise.resolve(fake);
}

function stripBIO(label: string): { tag: string; boundary: "B" | "I" | "O" } {
  const m = /^([BI])-(.+)$/.exec(label);
  if (m) return { boundary: m[1] as "B" | "I", tag: m[2].toUpperCase() };
  return { boundary: "O", tag: label.toUpperCase() };
}

function mapTagToType(tag: string): NerMention["type"] | null {
  if (tag === "PER" || tag === "PERSON") return "person";
  if (tag === "ORG" || tag === "ORGANIZATION") return "organization";
  if (tag === "LOC" || tag === "LOCATION" || tag === "GPE") return "location";
  return null;
}

// Merge a stream of (subword, B-/I- tag) entries into whole-word spans.
// A new span starts on a B- tag or a tag change; I- tags continue the
// current span. Subword pieces prefixed with "##" are concatenated to the
// previous token without a space; clean tokens are joined with a space.
function aggregate(raw: RawEntity[]): AggregatedSpan[] {
  const out: AggregatedSpan[] = [];
  let cur: AggregatedSpan | null = null;
  let prevIndex = -2;
  for (const r of raw) {
    const label = r.entity_group ?? r.entity ?? "";
    const { tag, boundary } = stripBIO(label);
    if (!tag || tag === "O") {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      prevIndex = r.index ?? -2;
      continue;
    }
    const word = r.word ?? "";
    const isSubword = word.startsWith("##");
    const piece = isSubword ? word.slice(2) : word;
    const contiguous = (r.index ?? -99) === prevIndex + 1;
    const continuesSpan =
      cur !== null && cur.tag === tag && (isSubword || (boundary === "I" && contiguous));
    if (continuesSpan) {
      cur!.word = isSubword ? cur!.word + piece : `${cur!.word} ${piece}`;
      cur!.score = Math.min(cur!.score, r.score);
    } else {
      if (cur) out.push(cur);
      cur = { tag, word: piece, score: r.score };
    }
    prevIndex = r.index ?? -2;
  }
  if (cur) out.push(cur);
  return out;
}

interface Chunk {
  text: string;
  offset: number;
}

// Split the input into sentence-aligned chunks, each no larger than
// MAX_CHUNK_CHARS. Very long single sentences are hard-split to stay under
// the cap (rare, but auto-generated transcripts without punctuation hit it).
export function chunkText(text: string): Chunk[] {
  const sentences = segmentSentences(text);
  const chunks: Chunk[] = [];
  if (sentences.length === 0) {
    for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) {
      chunks.push({ text: text.slice(i, i + MAX_CHUNK_CHARS), offset: i });
    }
    return chunks;
  }
  let bufStart = sentences[0].start;
  let bufEnd = sentences[0].start;
  for (const s of sentences) {
    const spanLen = s.end - bufStart;
    if (spanLen > MAX_CHUNK_CHARS && bufEnd > bufStart) {
      chunks.push({ text: text.slice(bufStart, bufEnd), offset: bufStart });
      bufStart = s.start;
    }
    if (s.end - s.start > MAX_CHUNK_CHARS) {
      // Pathological sentence: hard-split it.
      for (let i = s.start; i < s.end; i += MAX_CHUNK_CHARS) {
        const end = Math.min(i + MAX_CHUNK_CHARS, s.end);
        chunks.push({ text: text.slice(i, end), offset: i });
      }
      bufStart = s.end;
      bufEnd = s.end;
      continue;
    }
    bufEnd = s.end;
  }
  if (bufEnd > bufStart) {
    chunks.push({ text: text.slice(bufStart, bufEnd), offset: bufStart });
  }
  return chunks;
}

export interface RunNerOptions {
  minScore?: number;
}

export async function runNer(
  text: string,
  opts: RunNerOptions = {},
): Promise<NerMention[]> {
  if (!text || text.length === 0) return [];
  const pipe = await loadPipeline();
  if (!pipe) return [];
  const minScore = opts.minScore ?? 0.85;
  const out: NerMention[] = [];
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    let raw: RawEntity[] = [];
    try {
      raw = await pipe(chunk.text);
    } catch (err) {
       
      console.warn("[ner] chunk inference failed:", (err as Error).message);
      continue;
    }
    const spans = aggregate(raw);
    let cursor = 0;
    for (const s of spans) {
      if (s.score < minScore) continue;
      const type = mapTagToType(s.tag);
      if (!type) continue;
      const located = locateWord(chunk.text, s.word, cursor);
      if (!located) continue;
      cursor = located.end;
      out.push({
        type,
        surface: chunk.text.slice(located.start, located.end),
        start: located.start + chunk.offset,
        end: located.end + chunk.offset,
        score: s.score,
      });
    }
  }
  return dedupeOverlaps(out);
}

// Find the next occurrence of `word` in `text` at or after `from`. The word
// may contain spaces (multi-token entity). We try an exact case-sensitive
// match first, then fall back to case-insensitive, then to a loose match
// that ignores runs of whitespace. Returns {start,end} or null.
function locateWord(
  text: string,
  word: string,
  from: number,
): { start: number; end: number } | null {
  if (!word) return null;
  const exact = text.indexOf(word, from);
  if (exact >= 0) return { start: exact, end: exact + word.length };
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();
  const ci = lowerText.indexOf(lowerWord, from);
  if (ci >= 0) return { start: ci, end: ci + word.length };
  // Loose: collapse whitespace. Walk a sliding window comparing condensed forms.
  const condensed = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const needle = condensed(word);
  for (let i = from; i <= text.length - needle.length; i++) {
    if (condensed(text.slice(i, i + needle.length + 4)).startsWith(needle)) {
      return { start: i, end: i + needle.length };
    }
  }
  return null;
}

// Drop exact-duplicate spans and keep the higher-scoring of any two spans
// that share character range. Cross-span overlaps from different sentences
// are rare after chunking but cheap to filter.
function dedupeOverlaps(mentions: NerMention[]): NerMention[] {
  const byKey = new Map<string, NerMention>();
  for (const m of mentions) {
    const key = `${m.start}:${m.end}`;
    const existing = byKey.get(key);
    if (!existing || m.score > existing.score) byKey.set(key, m);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start);
}
