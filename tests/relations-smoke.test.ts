// Commit 2 smoke test for the relations module. Uses a fake GLiREL
// pipeline injected via the test hook so no model or subprocess is
// touched.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PersistedEntities,
  Transcript,
} from "../src/entities/index.ts";
import { writePersistedEntities } from "../src/entities/index.ts";
import {
  __setGlirelPipelineForTests,
  extractRelations,
  loadRelationsConfig,
  runRelationsStage,
  writePersistedRelations,
  type GlirelPipeline,
  type PersistedRelations,
} from "../src/relations/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";

function makeTranscript(): Transcript {
  return {
    videoId: "rel_smoke_001",
    cues: [
      { start: 0, duration: 3, text: "Dan Brown founded a studio in Boston." },
      { start: 3, duration: 3, text: "He wrote several books." },
    ],
  };
}

function makeEntities(transcriptId: string): PersistedEntities {
  // Spans chosen to land inside the first sentence so pair enumeration
  // produces real candidates.
  return {
    schemaVersion: 1,
    transcriptId,
    model: "fake",
    modelVersion: null,
    labelsUsed: ["person", "facility", "location"],
    corefApplied: false,
    generatedAt: "2026-04-14T00:00:00.000Z",
    mentions: [
      {
        id: "m_0001",
        label: "person",
        surface: "Dan Brown",
        canonical: "Dan Brown",
        span: { transcriptId, charStart: 0, charEnd: 9, timeStart: 0, timeEnd: 3 },
        score: 0.95,
      },
      {
        id: "m_0002",
        label: "facility",
        surface: "studio",
        canonical: "studio",
        span: { transcriptId, charStart: 20, charEnd: 26, timeStart: 0, timeEnd: 3 },
        score: 0.8,
      },
      {
        id: "m_0003",
        label: "location",
        surface: "Boston",
        canonical: "Boston",
        span: { transcriptId, charStart: 30, charEnd: 36, timeStart: 0, timeEnd: 3 },
        score: 0.92,
      },
    ],
  };
}

// Fake GLiREL: returns hand-picked scores for each batched sentence.
// Matches the new batch-oriented pipeline interface so one spawn per
// transcript replaces spawn-per-sentence.
function makeFakePipeline(): GlirelPipeline {
  return {
    async scoreBatch(sentences) {
      return sentences.map((sent) => {
        if (sent.entities.length < 2) return [];
        return [
          { subjectIndex: 0, objectIndex: 1, predicate: "founded",    score: 0.88 },
          { subjectIndex: 0, objectIndex: 2, predicate: "located_in", score: 0.9  },
          // Deliberately below any reasonable per-predicate threshold.
          { subjectIndex: 1, objectIndex: 2, predicate: "caused",     score: 0.05 },
        ];
      });
    },
  };
}

describe("relations module smoke", () => {
  beforeEach(() => {
    __setGlirelPipelineForTests(null);
  });

  it("extractRelations returns no edges when GLiREL is unavailable", async () => {
    const t = makeTranscript();
    const e = makeEntities(t.videoId);
    const cfg = loadRelationsConfig(process.cwd());
    const out = await extractRelations(t, e, { config: cfg });
    expect(out.schemaVersion).toBe(1);
    expect(out.transcriptId).toBe(t.videoId);
    expect(out.edges.length).toBe(0);
  });

  it("extractRelations uses the injected fake pipeline end-to-end", async () => {
    __setGlirelPipelineForTests(makeFakePipeline());
    const t = makeTranscript();
    const e = makeEntities(t.videoId);
    const cfg = loadRelationsConfig(process.cwd());
    const out = await extractRelations(t, e, { config: cfg });
    // Two edges above threshold, one below — expect two.
    expect(out.edges.length).toBe(2);
    const preds = out.edges.map((ed) => ed.predicate).sort();
    expect(preds).toEqual(["founded", "located_in"]);
    for (const edge of out.edges) {
      expect(edge.subjectMentionId.startsWith("m_")).toBe(true);
      expect(edge.objectMentionId.startsWith("m_")).toBe(true);
      expect(edge.evidence.transcriptId).toBe(t.videoId);
      expect(edge.evidence.charEnd).toBeGreaterThan(edge.evidence.charStart);
    }
  });

  it("writes persisted output to data/relations/<id>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "captions-relations-"));
    try {
      const payload: PersistedRelations = {
        schemaVersion: 1,
        transcriptId: "rel_smoke_002",
        model: "fake",
        modelVersion: null,
        predicatesUsed: [],
        generatedAt: "2026-04-14T00:00:00.000Z",
        edges: [],
      };
      const path = writePersistedRelations("rel_smoke_002", payload, dir);
      expect(path.endsWith(join("relations", "rel_smoke_002.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runRelationsStage skips cleanly when entities output is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "captions-relations-"));
    try {
      // Write a transcript but no entities output.
      mkdirSync(join(dir, "transcripts"), { recursive: true });
      writeFileSync(
        join(dir, "transcripts", "no_entities.json"),
        JSON.stringify(makeTranscript()),
      );
      const outcome = await runRelationsStage(
        { videoId: "no_entities" },
        { dataDir: dir, repoRoot: process.cwd() },
      );
      expect(outcome.kind).toBe("skip");
      expect(outcome.reason ?? "").toContain("entities");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runRelationsStage emits edges when both inputs exist", async () => {
    __setGlirelPipelineForTests(makeFakePipeline());
    const dir = mkdtempSync(join(tmpdir(), "captions-relations-"));
    try {
      const t = makeTranscript();
      mkdirSync(join(dir, "transcripts"), { recursive: true });
      writeFileSync(join(dir, "transcripts", `${t.videoId}.json`), JSON.stringify(t));
      writePersistedEntities(t.videoId, makeEntities(t.videoId), dir);
      const outcome = await runRelationsStage(
        { videoId: t.videoId },
        { dataDir: dir, repoRoot: process.cwd() },
      );
      expect(outcome.kind).toBe("ok");
      expect(outcome.edgeCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
