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
  statSync,
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
export type StageName = "fetched" | "nlp" | "ai" | "per-claim";

export interface StageRecord {
  at: string;       // ISO timestamp when the stage last ran
  version: number;  // bumped when the stage's implementation changes
  notes?: string;
}

export type StageMap = Partial<Record<StageName, StageRecord>>;

export type GraphStageName =
  | "propagation"
  | "per-claim"
  | "novel"
  | "contradictions";

export interface GraphWatermark {
  // Any per-video write that touches the graph bumps this. Graph-level stages
  // run when their own lastRanAt is older than dirtyAt.
  dirtyAt: string;
  stages: Partial<Record<GraphStageName, { at: string; version: number }>>;
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
  fetchedAt?: string;
  attempts: number;
  lastError?: string;
  errorReason?: ErrorReason;
  // Per-video pipeline stage state. Additive over `status`: fetch callers
  // keep writing `status`/`fetchedAt`, and the pipeline runner also writes
  // stages.fetched so downstream stages have a uniform interface.
  stages?: StageMap;
}

interface CatalogFile {
  version: number;
  rows: Record<string, CatalogRow>;
  graph?: GraphWatermark;
}

export const CATALOG_SCHEMA_VERSION = 2;

// Data-dir used by the v1→v2 migration to infer which stages have already
// run based on what's on disk. Defaults to the repo data/ dir but overridable
// for tests.
let inferDataDir: string | null = null;
export function setMigrationDataDir(path: string | null): void {
  inferDataDir = path;
}

function defaultDataDir(): string {
  return join(process.cwd(), "data");
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

// v1→v2: add the `stages` map per row and the top-level `graph` watermark.
// The upgrade reads the filesystem to infer which stages are already
// complete, so an existing corpus doesn't need a full re-run.
function migrateV1toV2(f: CatalogFile): CatalogFile {
  const dataDir = inferDataDir ?? defaultDataDir();
  const nlpDir = join(dataDir, "nlp");
  const now = new Date().toISOString();

  const nextRows: Record<string, CatalogRow> = {};
  for (const [id, row] of Object.entries(f.rows)) {
    const stages: StageMap = row.stages ?? {};
    if (row.status === "fetched" && !stages.fetched) {
      stages.fetched = {
        at: row.fetchedAt ?? now,
        version: 1,
      };
    }
    const nlpFile = join(nlpDir, `${id}.json`);
    const nlpMtime = safeMtime(nlpFile);
    if (nlpMtime > 0 && !stages.nlp) {
      stages.nlp = {
        at: new Date(nlpMtime).toISOString(),
        version: 1,
      };
    }
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

const migrations: Array<(f: CatalogFile) => CatalogFile> = [
  // Index 0 migrates v0 → v1.
  (f) => ({ version: 1, rows: f.rows ?? {} }),
  // Index 1 migrates v1 → v2 (stage map + graph watermark).
  migrateV1toV2,
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
        attempts: 0,
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
    record: { at: string; version: number },
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
