// Pipeline runner tests. Uses fake stages to drive the state machine so the
// assertions don't depend on NLP/AI/truth internals or on the network.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../src/catalog/catalog.js";
import { runPipeline } from "../src/pipeline/run.js";
import { VideoStage, GraphStage } from "../src/pipeline/types.js";

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

  // Integration coverage for the real neural stages lives in
  // tests/entities-smoke.test.ts and tests/relations-smoke.test.ts,
  // which drive the stage functions against fake GLiNER/GLiREL
  // pipelines injected via the test hooks in tests/helpers/setup.ts.

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
