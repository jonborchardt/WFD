// Pipeline runner tests. Uses fake stages to drive the state machine so the
// assertions don't depend on NLP/AI/truth internals or on the network.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../src/catalog/catalog.js";
import { runPipeline } from "../src/pipeline/run.js";
import { VideoStage, GraphStage, PipelineContext } from "../src/pipeline/types.js";
import { nlpStage } from "../src/pipeline/stages.js";
import { GraphStore } from "../src/graph/store.js";
import { readPersistedNlp } from "../src/nlp/persist.js";
import { readFileSync, existsSync } from "node:fs";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "captions-pipe-"));
}

function seedCatalog(path: string): Catalog {
  mkdirSync(join(path, "catalog"), { recursive: true });
  const c = new Catalog(join(path, "catalog", "catalog.json"));
  c.seed([{ videoId: "aaa", sourceUrl: "x" }]);
  return c;
}

describe("runPipeline", () => {
  let dir: string;
  let catalog: Catalog;

  beforeEach(() => {
    dir = makeTmp();
    catalog = seedCatalog(dir);
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it("runs a stage once, then skips it on a second run", async () => {
    let calls = 0;
    const stage: VideoStage = {
      name: "fetched",
      dependsOn: [],
      async run() {
        calls++;
        return { kind: "ok" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    expect(calls).toBe(1);
    expect(catalog.getStage("aaa", "fetched")?.at).toBeTypeOf("string");
  });

  it("reruns when the stage record is deleted", async () => {
    let calls = 0;
    const stage: VideoStage = {
      name: "fetched",
      dependsOn: [],
      async run() {
        calls++;
        return { kind: "ok" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    expect(calls).toBe(1);

    // Staleness is timestamp-driven, not version-driven. The operator-facing
    // knob for "force this stage to re-run" is to delete the stage record.
    catalog.clearStage("aaa", "fetched");
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    expect(calls).toBe(2);
  });

  it("respects dependsOn ordering", async () => {
    const order: string[] = [];
    const fetched: VideoStage = {
      name: "fetched",
      dependsOn: [],
      async run() {
        order.push("fetched");
        return { kind: "ok" };
      },
    };
    const nlp: VideoStage = {
      name: "nlp",
      dependsOn: ["fetched"],
      async run() {
        order.push("nlp");
        return { kind: "ok" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [fetched, nlp],
      graphStages: [],
    });
    expect(order).toEqual(["fetched", "nlp"]);
  });

  it("leaves an awaiting stage unmarked so it re-runs next time", async () => {
    let calls = 0;
    const stage: VideoStage = {
      name: "ai",
      dependsOn: [],
      async run() {
        calls++;
        return { kind: "awaiting", notes: "external" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
    });
    expect(calls).toBe(2);
    expect(catalog.getStage("aaa", "ai")).toBeUndefined();
  });

  it("runs graph stage once per dirty watermark", async () => {
    let calls = 0;
    const dirty: VideoStage = {
      name: "nlp",
      dependsOn: [],
      async run(_row, ctx) {
        ctx.catalog.markGraphDirty();
        return { kind: "ok" };
      },
    };
    const graph: GraphStage = {
      name: "propagation",
      async run() {
        calls++;
        return { kind: "ok" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [dirty],
      graphStages: [graph],
    });
    expect(calls).toBe(1);

    // Second run: no fresh dirty bump from the nlp stage (already complete),
    // so propagation should not re-run.
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [dirty],
      graphStages: [graph],
    });
    expect(calls).toBe(1);
  });

  it("adding a new video bumps graph dirty and re-runs graph stages", async () => {
    let calls = 0;
    const dirty: VideoStage = {
      name: "nlp",
      dependsOn: [],
      async run(_row, ctx) {
        ctx.catalog.markGraphDirty();
        return { kind: "ok" };
      },
    };
    const graph: GraphStage = {
      name: "propagation",
      async run() {
        calls++;
        return { kind: "ok" };
      },
    };
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [dirty],
      graphStages: [graph],
    });
    expect(calls).toBe(1);

    // Simulate adding a second video. The runner should process its nlp
    // stage, which bumps dirtyAt, and the graph stage should re-run.
    catalog.seed([{ videoId: "bbb", sourceUrl: "y" }]);
    await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [dirty],
      graphStages: [graph],
    });
    expect(calls).toBe(2);
  });

  // Integration: drive the real nlpStage against a fixture transcript on
  // disk. This covers the stage→module wiring (extract, extractRelationships,
  // writePersistedNlp, graph store upserts, markGraphDirty) that the
  // fake-stage tests above deliberately bypass.
  it("nlpStage: real extractor end-to-end writes nlp file + graph store", async () => {
    // Lay down a fixture transcript under data/transcripts/.
    const fixture = {
      videoId: "aaa",
      language: "en",
      kind: "auto",
      cues: [
        { start: 0, duration: 3, text: "NASA met with OpenAI in Washington." },
        { start: 3, duration: 3, text: "The FBI attended a meeting in London." },
        { start: 6, duration: 3, text: "Anthropic worked for OpenAI on the treaty." },
      ],
    };
    const tDir = join(dir, "transcripts");
    mkdirSync(tDir, { recursive: true });
    writeFileSync(join(tDir, "aaa.json"), JSON.stringify(fixture), "utf8");
    // Mark the catalog row as fetched so dep checks pass, and point it at
    // the fixture.
    catalog.update("aaa", {
      status: "fetched",
      transcriptPath: join(tDir, "aaa.json"),
      stages: {
        fetched: { at: "2025-01-01T00:00:00Z" },
      },
    });

    const beforeDirty = catalog.graphState().dirtyAt;
    // Force a tick so the post-run dirtyAt is strictly greater.
    await new Promise((r) => setTimeout(r, 5));

    const ctx: PipelineContext = {
      catalog,
      dataDir: dir,
      getStore: (() => {
        let s: GraphStore | null = null;
        return () => {
          if (!s) s = new GraphStore(join(dir, "graph", "graph.json"));
          return s;
        };
      })(),
    };

    const row = catalog.get("aaa")!;
    const outcome = await nlpStage.run(row, ctx);
    expect(outcome.kind).toBe("ok");

    // Persisted per-video NLP file exists and has content.
    const persisted = readPersistedNlp("aaa", dir);
    expect(persisted).not.toBeNull();
    expect(persisted!.entities.length).toBeGreaterThan(0);
    expect(persisted!.relationships.length).toBeGreaterThan(0);

    // Graph store has the transcript registered and at least one entity.
    const store = ctx.getStore();
    expect(store.entities().length).toBeGreaterThan(0);
    // Every stored relationship must point at our transcript id.
    for (const r of store.relationships()) {
      expect(r.evidence.transcriptId).toBe("aaa");
    }

    // markGraphDirty was called.
    expect(catalog.graphState().dirtyAt > beforeDirty).toBe(true);

    // Graph store file was written to disk.
    expect(existsSync(join(dir, "graph", "graph.json"))).toBe(true);
    const rawGraph = JSON.parse(
      readFileSync(join(dir, "graph", "graph.json"), "utf8"),
    );
    expect(rawGraph.transcripts.aaa).toBe(true);
  });

  it("dry-run reports stages without mutating the catalog", async () => {
    const stage: VideoStage = {
      name: "fetched",
      dependsOn: [],
      async run() {
        throw new Error("should not run in dry-run");
      },
    };
    const result = await runPipeline({
      catalog,
      dataDir: dir,
      videoStages: [stage],
      graphStages: [],
      dryRun: true,
    });
    expect(result.videoStagesRan).toHaveLength(1);
    expect(catalog.getStage("aaa", "fetched")).toBeUndefined();
  });
});
