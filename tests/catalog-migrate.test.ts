// Migration safety tests for src/catalog/catalog.ts.
//
// Locks the current on-disk schema so Phase 1's v1→v2 migration can't silently
// drop rows or invent state. The fixtures here are hand-crafted, but the final
// test also loads the real data/catalog/catalog.json (if present) and asserts
// the row count survives a round-trip through migrate().

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Catalog,
  migrate,
  CATALOG_SCHEMA_VERSION,
  setMigrationDataDir,
} from "../src/catalog/catalog.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "captions-cat-"));
}

describe("catalog migrate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
  });

  it("migrates a raw v0 blob to current schema version", () => {
    const raw = {
      rows: {
        aaa: {
          videoId: "aaa",
          sourceUrl: "https://www.youtube.com/watch?v=aaa",
          status: "fetched",
          attempts: 1,
          transcriptPath: "/tmp/aaa.json",
          fetchedAt: "2025-01-01T00:00:00Z",
        },
      },
    };
    const migrated = migrate(raw);
    expect(migrated.version).toBe(CATALOG_SCHEMA_VERSION);
    expect(Object.keys(migrated.rows)).toEqual(["aaa"]);
    expect(migrated.rows.aaa.status).toBe("fetched");
    expect((migrated.rows.aaa as Record<string, unknown>).attempts).toBeUndefined();
    expect((migrated.rows.aaa as Record<string, unknown>).fetchedAt).toBeUndefined();
    // v1→v2 should still have seeded stages.fetched from the legacy fetchedAt.
    expect(migrated.rows.aaa.stages?.fetched?.at).toBe("2025-01-01T00:00:00Z");
  });

  it("preserves every row key through round-trip", () => {
    const raw = {
      version: 1,
      rows: {
        a: { videoId: "a", sourceUrl: "x", status: "pending", attempts: 0 },
        b: { videoId: "b", sourceUrl: "y", status: "fetched", attempts: 2 },
        c: { videoId: "c", sourceUrl: "z", status: "failed-retryable", attempts: 3 },
      },
    };
    const migrated = migrate(raw);
    expect(Object.keys(migrated.rows).sort()).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      expect(migrated.rows[id].videoId).toBe(id);
    }
  });

  it("loads, persists, and reloads a catalog without losing rows", () => {
    const path = join(tmp, "catalog.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        rows: {
          a: { videoId: "a", sourceUrl: "x", status: "pending", attempts: 0 },
          b: { videoId: "b", sourceUrl: "y", status: "fetched", attempts: 1 },
        },
      }),
      "utf8",
    );
    const c1 = new Catalog(path);
    expect(c1.all().map((r) => r.videoId).sort()).toEqual(["a", "b"]);
    // Trigger a persist.
    c1.update("a", { lastError: "boom" });
    const c2 = new Catalog(path);
    expect(c2.get("a")?.lastError).toBe("boom");
    expect(c2.get("b")?.status).toBe("fetched");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("v1→v2 infers stages.fetched from status and stages.nlp from disk", () => {
    // Stand up a throwaway data dir with one NLP file present.
    const dataDir = join(tmp, "data");
    mkdirSync(join(dataDir, "nlp"), { recursive: true });
    writeFileSync(
      join(dataDir, "nlp", "aaa.json"),
      JSON.stringify({ entities: [], relationships: [] }),
      "utf8",
    );
    setMigrationDataDir(dataDir);
    try {
      const raw = {
        version: 1,
        rows: {
          aaa: {
            videoId: "aaa",
            sourceUrl: "x",
            status: "fetched",
            attempts: 1,
            fetchedAt: "2025-03-01T00:00:00Z",
          },
          bbb: {
            videoId: "bbb",
            sourceUrl: "y",
            status: "pending",
            attempts: 0,
          },
        },
      };
      const migrated = migrate(raw);
      expect(migrated.version).toBe(CATALOG_SCHEMA_VERSION);
      expect(migrated.rows.aaa.stages?.fetched).toBeDefined();
      expect(migrated.rows.aaa.stages?.fetched?.at).toBe("2025-03-01T00:00:00Z");
      expect(migrated.rows.aaa.stages?.nlp).toBeDefined();
      // bbb has neither fetched nor an nlp file → no stages populated.
      expect(migrated.rows.bbb.stages?.fetched).toBeUndefined();
      expect(migrated.rows.bbb.stages?.nlp).toBeUndefined();
      // Graph watermark is seeded as dirty.
      expect(migrated.graph?.dirtyAt).toBeTruthy();
      expect(migrated.graph?.stages).toEqual({});
    } finally {
      setMigrationDataDir(null);
    }
  });

  it("writes a .v1.bak next to the catalog when auto-migrating on load", () => {
    const path = join(tmp, "catalog.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        rows: {
          aaa: { videoId: "aaa", sourceUrl: "x", status: "fetched", attempts: 1 },
        },
      }),
      "utf8",
    );
    setMigrationDataDir(join(tmp, "data"));
    try {
      const c = new Catalog(path);
      expect(c.version()).toBe(CATALOG_SCHEMA_VERSION);
      expect(existsSync(`${path}.v1.bak`)).toBe(true);
      // The backup still reports v1 on disk.
      const backup = JSON.parse(readFileSync(`${path}.v1.bak`, "utf8"));
      expect(backup.version).toBe(1);
    } finally {
      setMigrationDataDir(null);
    }
  });

  it("setStage and markGraphDirty persist and round-trip", () => {
    const path = join(tmp, "catalog.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: CATALOG_SCHEMA_VERSION,
        rows: {
          aaa: {
            videoId: "aaa",
            sourceUrl: "x",
            status: "fetched",
            attempts: 1,
            stages: { fetched: { at: "2025-01-01T00:00:00Z" } },
          },
        },
        graph: { dirtyAt: "2025-01-01T00:00:00Z", stages: {} },
      }),
      "utf8",
    );
    const c1 = new Catalog(path);
    c1.setStage("aaa", "nlp", { at: "2025-02-01T00:00:00Z" });
    c1.markGraphDirty();
    c1.setGraphStage("propagation", { at: "2025-02-01T00:01:00Z" });

    const c2 = new Catalog(path);
    expect(c2.getStage("aaa", "nlp")?.at).toBe("2025-02-01T00:00:00Z");
    const g = c2.graphState();
    expect(g.dirtyAt > "2025-01-01T00:00:00Z").toBe(true);
    expect(g.stages.propagation?.at).toBe("2025-02-01T00:01:00Z");
  });

  it("v2→v3 strips legacy `version` fields from stage records", () => {
    const raw = {
      version: 2,
      rows: {
        aaa: {
          videoId: "aaa",
          sourceUrl: "x",
          status: "fetched",
          attempts: 1,
          stages: {
            fetched: { at: "2025-01-01T00:00:00Z", version: 1 },
            nlp: { at: "2025-01-02T00:00:00Z", version: 5, notes: "62 ents" },
          },
        },
      },
      graph: {
        dirtyAt: "2025-01-01T00:00:00Z",
        stages: {
          propagation: { at: "2025-01-03T00:00:00Z", version: 2 },
        },
      },
    };
    const migrated = migrate(raw);
    expect(migrated.version).toBe(CATALOG_SCHEMA_VERSION);
    const fetched = migrated.rows.aaa.stages?.fetched as Record<string, unknown>;
    expect(fetched.version).toBeUndefined();
    expect(fetched.at).toBe("2025-01-01T00:00:00Z");
    const nlp = migrated.rows.aaa.stages?.nlp as Record<string, unknown>;
    expect(nlp.version).toBeUndefined();
    expect(nlp.at).toBe("2025-01-02T00:00:00Z");
    expect(nlp.notes).toBe("62 ents");
    const prop = migrated.graph?.stages.propagation as Record<string, unknown>;
    expect(prop.version).toBeUndefined();
    expect(prop.at).toBe("2025-01-03T00:00:00Z");
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  // Guardrail against the real catalog: if data/catalog/catalog.json is
  // present, assert migrate() survives it without throwing and returns the
  // same row count as the raw JSON. Skipped when the file is absent so CI
  // without corpus data still passes.
  it("round-trips the real data/catalog/catalog.json if present", () => {
    const real = Catalog.defaultPath();
    if (!existsSync(real)) return;
    const raw = JSON.parse(readFileSync(real, "utf8")) as {
      rows?: Record<string, unknown>;
    };
    const rawCount = Object.keys(raw.rows ?? {}).length;
    const migrated = migrate(raw);
    expect(Object.keys(migrated.rows).length).toBe(rawCount);
    expect(migrated.version).toBe(CATALOG_SCHEMA_VERSION);
  });
});
