// AI enrichment pass.
//
// This is NOT a runtime API call to Claude. Per CLAUDE.md, the pass is a
// batch driver invoked via Claude Code: it iterates transcripts (or graph
// slices), writes a prompt bundle per slice, and — after the operator runs
// Claude Code over those bundles — ingests the JSON responses back into the
// graph store with provenance "ai" (or "both" if the same edge came from NLP).
//
// The pass is idempotent: re-running with the same responses does not
// double-write relationships. The graph store's upsertRelationship merges by
// id and promotes provenance to "both" when a second source arrives.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Entity, Relationship } from "../shared/types.js";
import { GraphStore } from "../graph/store.js";
import { isValidRelationship, createRelationship } from "../nlp/relationships.js";
import { Transcript } from "../nlp/entities.js";

export interface EnrichmentBundle {
  transcriptId: string;
  entities: Array<{ id: string; type: string; canonical: string }>;
  cues: Array<{ index: number; start: number; text: string }>;
  instructions: string;
}

// Build a prompt bundle for a single transcript slice. The format is JSON-ish
// so Claude Code can emit new relationships with the same schema back.
export function buildBundle(
  transcript: Transcript,
  entities: Entity[],
): EnrichmentBundle {
  return {
    transcriptId: transcript.videoId,
    entities: entities.map((e) => ({
      id: e.id,
      type: e.type,
      canonical: e.canonical,
    })),
    cues: transcript.cues.map((c, i) => ({
      index: i,
      start: c.start,
      text: c.text,
    })),
    instructions: [
      "Read the cues and entity list. Return a JSON array of relationships",
      "the NLP layer may have missed, each with:",
      '{ "subjectId", "predicate", "objectId", "cueIndex", "confidence" }.',
      "Predicates must be one of: said, met, attended, worked-for,",
      "located-at, member-of, related-to. Every relationship MUST reference",
      "a specific cueIndex; we derive the char/time span from that cue.",
    ].join(" "),
  };
}

export function writeBundles(
  dir: string,
  bundles: EnrichmentBundle[],
): string[] {
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const b of bundles) {
    const p = join(dir, `${b.transcriptId}.bundle.json`);
    writeFileSync(p, JSON.stringify(b, null, 2), "utf8");
    paths.push(p);
  }
  return paths;
}

export interface AIResponseEdge {
  subjectId: string;
  predicate: string;
  objectId: string;
  cueIndex: number;
  confidence: number;
}

const VALID_PREDICATES = new Set([
  "said",
  "met",
  "attended",
  "worked-for",
  "located-at",
  "member-of",
  "related-to",
]);

export function parseAIResponse(
  raw: string,
): AIResponseEdge[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: AIResponseEdge[] = [];
  for (const e of parsed) {
    if (
      e &&
      typeof e === "object" &&
      typeof (e as any).subjectId === "string" &&
      typeof (e as any).objectId === "string" &&
      typeof (e as any).predicate === "string" &&
      VALID_PREDICATES.has((e as any).predicate) &&
      typeof (e as any).cueIndex === "number" &&
      typeof (e as any).confidence === "number"
    ) {
      out.push(e as AIResponseEdge);
    }
  }
  return out;
}

// Convert parsed AI edges into Relationship objects (with evidence pointers
// derived from the referenced cue) and ingest them.
export function ingestAIResponse(
  store: GraphStore,
  transcript: Transcript,
  edges: AIResponseEdge[],
): Relationship[] {
  store.registerTranscript(transcript.videoId);
  const out: Relationship[] = [];
  for (const e of edges) {
    const cue = transcript.cues[e.cueIndex];
    if (!cue) continue;
    let charStart = 0;
    for (let i = 0; i < e.cueIndex; i++) {
      charStart += transcript.cues[i].text.length + 1;
    }
    const rel = createRelationship({
      subjectId: e.subjectId,
      predicate: e.predicate as Relationship["predicate"],
      objectId: e.objectId,
      evidence: {
        transcriptId: transcript.videoId,
        charStart,
        charEnd: charStart + cue.text.length,
        timeStart: cue.start,
        timeEnd: cue.start + cue.duration,
      },
      confidence: Math.max(0, Math.min(1, e.confidence)),
    });
    // Mark as AI-derived before upsert so the store can merge to "both".
    const aiRel: Relationship = { ...rel, provenance: "ai" };
    out.push(store.upsertRelationship(aiRel));
  }
  return out;
}

// End-to-end driver: build bundles, wait for a response file per bundle, and
// ingest. In practice the operator runs Claude Code between writeBundles and
// ingestResponses; the tests run both halves with prerecorded responses.
export function ingestResponseFile(
  store: GraphStore,
  transcript: Transcript,
  responsePath: string,
): Relationship[] {
  if (!existsSync(responsePath)) return [];
  const raw = readFileSync(responsePath, "utf8");
  const edges = parseAIResponse(raw);
  return ingestAIResponse(store, transcript, edges);
}

export function validateForIngest(r: unknown): r is Relationship {
  return isValidRelationship(r);
}
