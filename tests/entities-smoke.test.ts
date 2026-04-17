// Commit 1 smoke test for the new entities module. Exercises the full
// in-memory path (flatten → canonicalize → persist) against a synthetic
// transcript with an injected fake GLiNER pipeline. The real model is
// never loaded and python/coref is short-circuited via the global test
// hook in tests/helpers/setup.ts.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __setGlinerPipelineForTests,
  canonicalize,
  extractEntities,
  flatten,
  loadConfig,
  runEntitiesStage,
  segmentSentences,
  writePersistedEntities,
  type GlinerPipeline,
  type PersistedEntities,
  type Transcript,
} from "../src/entities/index.ts";

function makeTranscript(): Transcript {
  return {
    videoId: "smoke_vid_001",
    cues: [
      { start: 0, duration: 2, text: "Dan Brown wrote The Da Vinci Code." },
      { start: 2, duration: 2, text: "He founded a studio in Boston." },
      { start: 4, duration: 2, text: "The studio was founded in 2004." },
    ],
  };
}

// A deterministic fake GLiNER: returns whatever mentions we hand it
// regardless of input text. Matches the GlinerPipeline interface so the
// wrapper treats it as a loaded model.
function makeFakePipeline(
  mentions: Array<{ label: string; start: number; end: number; score: number; text: string }>,
): GlinerPipeline {
  return {
    async predict() {
      return mentions;
    },
  };
}

describe("entities module smoke", () => {
  beforeEach(() => {
    __setGlinerPipelineForTests(null);
  });

  it("segments sentences without regex", () => {
    const text = "Dr. Smith met Alice. Then she left.";
    const sents = segmentSentences(text);
    expect(sents.length).toBe(2);
    expect(text.slice(sents[0].start, sents[0].end)).toContain("Dr. Smith");
  });

  it("flattens a transcript and builds cue offsets", () => {
    const t = makeTranscript();
    const flat = flatten(t);
    expect(flat.cueStarts.length).toBe(3);
    expect(flat.text.includes("Dan Brown")).toBe(true);
  });

  it("canonicalizes mentions by longest/most-frequent form and drops pronouns", () => {
    const t = makeTranscript();
    const flat = flatten(t);
    const raw = [
      { label: "person", start: 0, end: 9, score: 0.9, text: "Dan Brown" },
      // Pronouns are filtered by the canonicalizer — overwhelmingly noise
      // when GLiNER fires a pronoun as a person in zero-shot mode.
      { label: "person", start: 37, end: 39, score: 0.88, text: "He" },
      { label: "location", start: 56, end: 62, score: 0.92, text: "Boston" },
      { label: "date_time", start: 92, end: 96, score: 0.95, text: "2004" },
    ];
    const mentions = canonicalize(
      raw,
      ["person", "location", "date_time"],
      t,
      flat,
    );
    // "He" is dropped; the other three survive.
    expect(mentions.length).toBe(3);
    expect(mentions.find((m) => m.surface === "He")).toBeUndefined();
    const person = mentions.find((m) => m.surface === "Dan Brown");
    expect(person?.canonical).toBe("Dan Brown");
    const date = mentions.find((m) => m.label === "date_time");
    expect(date?.canonical).toBe("2004");
    expect(date?.span.timeStart).toBeGreaterThanOrEqual(0);
  });

  it("extractEntities returns an empty-mention payload when GLiNER is unavailable", async () => {
    const config = loadConfig(process.cwd());
    const payload = await extractEntities(makeTranscript(), { config });
    expect(payload.schemaVersion).toBe(1);
    expect(payload.transcriptId).toBe("smoke_vid_001");
    expect(payload.mentions.length).toBe(0);
    expect(payload.labelsUsed.includes("date_time")).toBe(true);
  });

  it("extractEntities uses an injected fake pipeline end-to-end", async () => {
    __setGlinerPipelineForTests(
      makeFakePipeline([
        { label: "person", start: 0, end: 9, score: 0.95, text: "Dan Brown" },
        { label: "date_time", start: 0, end: 4, score: 0.9, text: "2004" },
      ]),
    );
    const config = loadConfig(process.cwd());
    const payload = await extractEntities(makeTranscript(), { config });
    // The fake returns the same mentions for every chunk it sees. We just
    // care that at least one real mention made it through the full pipe.
    expect(payload.mentions.length).toBeGreaterThan(0);
    expect(payload.mentions.some((m) => m.label === "person")).toBe(true);
    expect(payload.mentions.some((m) => m.label === "date_time")).toBe(true);
    for (const m of payload.mentions) {
      expect(m.span.transcriptId).toBe("smoke_vid_001");
      expect(m.span.charEnd).toBeGreaterThan(m.span.charStart);
      expect(m.canonical.length).toBeGreaterThan(0);
      expect(m.id.startsWith("m_")).toBe(true);
    }
  });

  it("writes persisted output to data/entities/<id>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "captions-entities-"));
    try {
      const payload: PersistedEntities = {
        schemaVersion: 1,
        transcriptId: "smoke_vid_002",
        model: "fake",
        modelVersion: null,
        labelsUsed: ["person"],
        corefApplied: false,
        generatedAt: "2026-04-14T00:00:00.000Z",
        mentions: [],
      };
      const path = writePersistedEntities("smoke_vid_002", payload, dir);
      const round = JSON.parse(readFileSync(path, "utf8")) as PersistedEntities;
      expect(round.transcriptId).toBe("smoke_vid_002");
      expect(path.endsWith(join("entities", "smoke_vid_002.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runEntitiesStage skips cleanly when the transcript file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "captions-entities-"));
    try {
      const outcome = await runEntitiesStage(
        { videoId: "no_such_vid" },
        { dataDir: dir, repoRoot: process.cwd() },
      );
      expect(outcome.kind).toBe("skip");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
