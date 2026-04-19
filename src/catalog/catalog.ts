// Video ↔ transcript catalog.
//
// Storage: a single JSON file under data/catalog/catalog.json. JSON was picked
// over sqlite for now because it's zero-dependency and the expected corpus
// size (thousands, not millions) tolerates a full-file rewrite. The schema
// version at the top lets us migrate without wiping the catalog.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type CatalogStatus =
  | "pending"
  | "fetched"
  | "failed-retryable"
  | "failed-needs-user";

// Pipeline stages. The per-video stages (fetched, nlp, ai) run against a
// single row and write per-video artifacts. The graph-level stages
// (propagation, truth, novel, contradictions) are tracked on the file-level
// `graph` watermark instead of on individual rows — see GraphWatermark.
export type StageName =
  | "fetched"
  | "entities"
  | "date-normalize"
  | "relations"
  | "ai"
  | "per-claim";

export interface StageRecord {
  at: string;       // ISO timestamp when the stage last ran
  notes?: string;
}

export type StageMap = Partial<Record<StageName, StageRecord>>;

export type GraphStageName =
  | "propagation"
  | "per-claim"
  | "novel"
  | "contradictions"
  | "indexes";

export interface GraphWatermark {
  // Any per-video write that touches the graph bumps this. Graph-level stages
  // run when their own lastRanAt is older than dirtyAt.
  dirtyAt: string;
  stages: Partial<Record<GraphStageName, { at: string }>>;
}

export interface VideoMeta {
  title?: string;
  channel?: string;
  channelId?: string;
  description?: string;
  keywords?: string[];
  category?: string;
  uploadDate?: string;
  publishDate?: string;
  lengthSeconds?: number;
  viewCount?: number;
  thumbnailUrl?: string;
  isLiveContent?: boolean;
}

export type ErrorReason =
  | "no-captions"
  | "login-required"
  | "removed"
  | "network";

export interface CatalogRow extends VideoMeta {
  videoId: string;
  sourceUrl: string;
  transcriptPath?: string;
  status: CatalogStatus;
  lastError?: string;
  errorReason?: ErrorReason;
  // Per-video pipeline stage state. The `fetched` stage record is the sole
  // source of truth for "when was the transcript fetched"; downstream stages
  // read from here.
  stages?: StageMap;
}

interface CatalogFile {
  version: number;
  rows: Record<string, CatalogRow>;
  graph?: GraphWatermark;
}

export const CATALOG_SCHEMA_VERSION = 5;

// Historic v1→v2 migration used to read the filesystem to infer which
// stages had already run. That inference was specific to the retired
// `nlp` stage, so the hook is now a no-op kept for backwards
// compatibility with tests that still call it. Safe to drop once the
// tests are updated.
export function setMigrationDataDir(_path: string | null): void {
  /* no-op: migration no longer inspects the filesystem */
}

// v1→v2: add the `stages` map per row and the top-level `graph` watermark.
// The upgrade preserves any existing `fetched` timestamp but does not try
// to infer downstream stages — downstream stages (entities/relations/ai)
// will run fresh on the next pipeline tick.
function migrateV1toV2(f: CatalogFile): CatalogFile {
  const now = new Date().toISOString();

  const nextRows: Record<string, CatalogRow> = {};
  for (const [id, row] of Object.entries(f.rows)) {
    const stages: StageMap = row.stages ?? {};
    if (row.status === "fetched" && !stages.fetched) {
      const legacyFetchedAt = (row as { fetchedAt?: string }).fetchedAt;
      stages.fetched = { at: legacyFetchedAt ?? now };
    }
    // v1→v2 historically backfilled a `stages.nlp` record from the
    // mtime of `data/nlp/<id>.json`, but the nlp pipeline stage was
    // retired in favor of `entities` + `relations` and v4→v5 now
    // strips any stale `stages.nlp` key anyway. No backfill.
    nextRows[id] = { ...row, stages };
  }

  return {
    version: 2,
    rows: nextRows,
    // Seed the graph watermark as dirty so the first post-migration pipeline
    // run does a full propagation/novel/contradiction pass over the existing
    // corpus. Graph-level stages have no prior record, so they'll all run.
    graph: {
      dirtyAt: now,
      stages: {},
    },
  };
}

// v2→v3: strip the legacy `version` field from every stage record. Staleness
// is purely timestamp-driven now, so the field is dead data. No stage records
// are removed; only `version` is deleted from each one.
function migrateV2toV3(f: CatalogFile): CatalogFile {
  const nextRows: Record<string, CatalogRow> = {};
  for (const [id, row] of Object.entries(f.rows)) {
    if (row.stages) {
      const cleanedStages: StageMap = {};
      for (const [name, rec] of Object.entries(row.stages)) {
        if (!rec) continue;
        const { at, notes } = rec as StageRecord & { version?: unknown };
        cleanedStages[name as StageName] = notes !== undefined ? { at, notes } : { at };
      }
      nextRows[id] = { ...row, stages: cleanedStages };
    } else {
      nextRows[id] = row;
    }
  }
  let graph = f.graph;
  if (graph) {
    const cleanedGraphStages: Partial<Record<GraphStageName, { at: string }>> = {};
    for (const [name, rec] of Object.entries(graph.stages)) {
      if (!rec) continue;
      cleanedGraphStages[name as GraphStageName] = { at: rec.at };
    }
    graph = { dirtyAt: graph.dirtyAt, stages: cleanedGraphStages };
  }
  return { version: 3, rows: nextRows, graph };
}

// v3→v4: strip `fetchedAt` and `attempts` from every row. `fetchedAt` was
// fully redundant with `stages.fetched.at` (set by the v1→v2 migration), and
// `attempts` was the retry-exhaustion counter for the gap classifier — that
// gate has been removed in favor of manual triage.
function migrateV3toV4(f: CatalogFile): CatalogFile {
  const nextRows: Record<string, CatalogRow> = {};
  for (const [id, row] of Object.entries(f.rows)) {
    const { fetchedAt: _f, attempts: _a, ...rest } = row as CatalogRow & {
      fetchedAt?: string;
      attempts?: number;
    };
    void _f;
    void _a;
    nextRows[id] = rest;
  }
  return { version: 4, rows: nextRows, graph: f.graph };
}

// v4 → v5: the legacy `nlp` pipeline stage was retired and replaced by
// the split `entities` + `relations` stages. Old catalog rows may still
// carry a `stages.nlp` record left behind by the regex+BERT pipeline.
// Nothing reads that key any more, and leaving it on a row would fool
// the CLI "stage up-to-date" display into counting it. Strip it.
function migrateV4toV5(f: CatalogFile): CatalogFile {
  const nextRows: Record<string, CatalogRow> = {};
  for (const [id, row] of Object.entries(f.rows)) {
    if (row.stages && "nlp" in row.stages) {
      const { nlp: _nlp, ...keptStages } = row.stages as StageMap & {
        nlp?: unknown;
      };
      void _nlp;
      nextRows[id] = { ...row, stages: keptStages };
    } else {
      nextRows[id] = row;
    }
  }
  return { version: 5, rows: nextRows, graph: f.graph };
}

const migrations: Array<(f: CatalogFile) => CatalogFile> = [
  // Index 0 migrates v0 → v1.
  (f) => ({ version: 1, rows: f.rows ?? {} }),
  // Index 1 migrates v1 → v2 (stage map + graph watermark).
  migrateV1toV2,
  // Index 2 migrates v2 → v3 (drop legacy `version` field from stage records).
  migrateV2toV3,
  // Index 3 migrates v3 → v4 (drop `fetchedAt` and `attempts` from rows).
  migrateV3toV4,
  // Index 4 migrates v4 → v5 (strip legacy `stages.nlp` records).
  migrateV4toV5,
];

export function migrate(raw: unknown): CatalogFile {
  const r = (raw ?? {}) as {
    version?: unknown;
    rows?: Record<string, CatalogRow>;
    graph?: GraphWatermark;
  };
  let f: CatalogFile = {
    version: Number(r.version ?? 0),
    rows: r.rows ?? {},
    graph: r.graph,
  };
  while (f.version < CATALOG_SCHEMA_VERSION) {
    f = migrations[f.version](f);
  }
  return f;
}

export class Catalog {
  private data: CatalogFile;

  constructor(private path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: number };
      const rawVersion = Number(raw.version ?? 0);
      // Belt-and-braces: snapshot the pre-migration file so a bad v2 write
      // can be rolled back by hand. Only taken the first time we see a
      // version below current, and never overwritten.
      if (rawVersion < CATALOG_SCHEMA_VERSION) {
        const backup = `${path}.v${rawVersion}.bak`;
        if (!existsSync(backup)) {
          try {
            copyFileSync(path, backup);
          } catch {
            // Non-fatal: migration still proceeds. The migration itself is
            // idempotent so a second run doesn't compound damage.
          }
        }
      }
      this.data = migrate(raw);
      // If the raw version on disk was older than current, persist the
      // migrated form immediately so later readers don't have to re-migrate.
      if (rawVersion < CATALOG_SCHEMA_VERSION) {
        this.persist();
      }
    } else {
      this.data = {
        version: CATALOG_SCHEMA_VERSION,
        rows: {},
        graph: { dirtyAt: new Date().toISOString(), stages: {} },
      };
    }
  }

  static defaultPath(): string {
    return join(process.cwd(), "data", "catalog", "catalog.json");
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.path);
  }

  all(): CatalogRow[] {
    return Object.values(this.data.rows);
  }

  get(videoId: string): CatalogRow | undefined {
    return this.data.rows[videoId];
  }

  findByTranscriptPath(path: string): CatalogRow | undefined {
    return this.all().find((r) => r.transcriptPath === path);
  }

  upsert(row: CatalogRow): void {
    this.data.rows[row.videoId] = row;
    this.persist();
  }

  update(videoId: string, patch: Partial<CatalogRow>): CatalogRow {
    const existing = this.data.rows[videoId];
    if (!existing) throw new Error(`catalog: no row for ${videoId}`);
    const next = { ...existing, ...patch };
    this.data.rows[videoId] = next;
    this.persist();
    return next;
  }

  delete(videoId: string): void {
    delete this.data.rows[videoId];
    this.persist();
  }

  // Flip every failed-* row back to pending so the ingester picks it up
  // again. Returns how many rows were reset.
  resetFailed(): number {
    let n = 0;
    for (const row of Object.values(this.data.rows)) {
      if (
        row.status === "failed-retryable" ||
        row.status === "failed-needs-user"
      ) {
        row.status = "pending";
        row.lastError = undefined;
        row.errorReason = undefined;
        n++;
      }
    }
    if (n > 0) this.persist();
    return n;
  }

  // Seed a list of video ids/urls into `pending` state. Existing rows are
  // left alone so this is safe to re-run.
  seed(entries: Array<{ videoId: string; sourceUrl?: string }>): number {
    let added = 0;
    for (const e of entries) {
      if (this.data.rows[e.videoId]) continue;
      this.data.rows[e.videoId] = {
        videoId: e.videoId,
        sourceUrl: e.sourceUrl ?? `https://www.youtube.com/watch?v=${e.videoId}`,
        status: "pending",
      };
      added++;
    }
    if (added > 0) this.persist();
    return added;
  }

  version(): number {
    return this.data.version;
  }

  // ---- Per-video pipeline stages ----------------------------------------

  getStage(videoId: string, stage: StageName): StageRecord | undefined {
    return this.data.rows[videoId]?.stages?.[stage];
  }

  setStage(videoId: string, stage: StageName, record: StageRecord): void {
    const row = this.data.rows[videoId];
    if (!row) throw new Error(`catalog: no row for ${videoId}`);
    row.stages = { ...(row.stages ?? {}), [stage]: record };
    this.persist();
  }

  clearStage(videoId: string, stage: StageName): void {
    const row = this.data.rows[videoId];
    if (!row || !row.stages) return;
    delete row.stages[stage];
    this.persist();
  }

  // ---- Graph-level watermark --------------------------------------------

  graphState(): GraphWatermark {
    if (!this.data.graph) {
      this.data.graph = {
        dirtyAt: new Date().toISOString(),
        stages: {},
      };
      this.persist();
    }
    return this.data.graph;
  }

  // Called by any per-video stage that writes into the entity/relationship
  // graph. Bumps the watermark so graph-level stages know to re-run.
  markGraphDirty(): void {
    const now = new Date().toISOString();
    this.data.graph = {
      dirtyAt: now,
      stages: this.data.graph?.stages ?? {},
    };
    this.persist();
  }

  setGraphStage(
    stage: GraphStageName,
    record: { at: string },
  ): void {
    const g = this.graphState();
    g.stages[stage] = record;
    this.persist();
  }
}

// Parse a user-supplied list (urls or ids, one per line) into seed entries.
export function parseIdList(src: string): Array<{ videoId: string; sourceUrl: string }> {
  const out: Array<{ videoId: string; sourceUrl: string }> = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    if (m) {
      out.push({ videoId: m[1], sourceUrl: line });
      continue;
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(line)) {
      out.push({
        videoId: line,
        sourceUrl: `https://www.youtube.com/watch?v=${line}`,
      });
    }
  }
  return out;
}
