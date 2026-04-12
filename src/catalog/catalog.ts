// Video ↔ transcript catalog.
//
// Storage: a single JSON file under data/catalog/catalog.json. JSON was picked
// over sqlite for now because it's zero-dependency and the expected corpus
// size (thousands, not millions) tolerates a full-file rewrite. The schema
// version at the top lets us migrate without wiping the catalog.

import {
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

export interface CatalogRow {
  videoId: string;
  sourceUrl: string;
  title?: string;
  channel?: string;
  transcriptPath?: string;
  status: CatalogStatus;
  fetchedAt?: string;
  attempts: number;
  lastError?: string;
}

interface CatalogFile {
  version: number;
  rows: Record<string, CatalogRow>;
}

export const CATALOG_SCHEMA_VERSION = 1;

const migrations: Array<(f: CatalogFile) => CatalogFile> = [
  // Index 0 migrates v0 → v1. Future: push new migrations onto the end; the
  // loader replays from the file's recorded version forward.
  (f) => ({ version: 1, rows: f.rows ?? {} }),
];

export function migrate(raw: unknown): CatalogFile {
  const r = (raw ?? {}) as { version?: unknown; rows?: Record<string, CatalogRow> };
  let f: CatalogFile = {
    version: Number(r.version ?? 0),
    rows: r.rows ?? {},
  };
  while (f.version < CATALOG_SCHEMA_VERSION) {
    f = migrations[f.version](f);
  }
  return f;
}

export class Catalog {
  private data: CatalogFile;

  constructor(private path: string) {
    this.data = existsSync(path)
      ? migrate(JSON.parse(readFileSync(path, "utf8")))
      : { version: CATALOG_SCHEMA_VERSION, rows: {} };
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
