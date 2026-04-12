// Local navigation UI.
//
// UI stack rationale: a zero-dependency node:http server that renders vanilla
// HTML and serves JSON from the catalog + transcripts on disk. We deliberately
// avoid a frontend framework here: everything lives on the local machine, the
// catalog is small, and we want the CLI to start this with no build step.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Catalog, CatalogRow } from "../catalog/catalog.js";
import { transcriptPath } from "../ingest/transcript.js";
import { Ingester, IngestProgress } from "../ingest/ingester.js";
import { renderSpaShell } from "./spa-shell.js";
import { extract as extractEntities, Transcript as NlpTranscript } from "../nlp/entities.js";
import { extractRelationships } from "../nlp/relationships.js";
import { Entity, Relationship, TranscriptSpan } from "../shared/types.js";

interface NlpResult {
  entities: Entity[];
  relationships: Relationship[];
}

const nlpCache = new Map<string, NlpResult>();

interface EntityIndexEntry {
  id: string;
  type: Entity["type"];
  canonical: string;
  videoCount: number;
  mentionCount: number;
}
let entityIndexCache: { built: number; entries: EntityIndexEntry[] } | null = null;

function buildEntityIndex(catalog: Catalog, dataDir?: string): EntityIndexEntry[] {
  const agg = new Map<string, EntityIndexEntry>();
  for (const row of catalog.all()) {
    if (row.status !== "fetched") continue;
    const nlp = computeNlp(row, dataDir);
    if (!nlp) continue;
    for (const e of nlp.entities) {
      const existing = agg.get(e.id);
      if (existing) {
        existing.videoCount += 1;
        existing.mentionCount += e.mentions.length;
      } else {
        agg.set(e.id, {
          id: e.id,
          type: e.type,
          canonical: e.canonical,
          videoCount: 1,
          mentionCount: e.mentions.length,
        });
      }
    }
  }
  return [...agg.values()];
}

function getEntityIndex(catalog: Catalog, dataDir?: string): EntityIndexEntry[] {
  if (entityIndexCache) return entityIndexCache.entries;
  const entries = buildEntityIndex(catalog, dataDir);
  entityIndexCache = { built: Date.now(), entries };
  return entries;
}

function computeNlp(row: CatalogRow, dataDir?: string): NlpResult | null {
  const cached = nlpCache.get(row.videoId);
  if (cached) return cached;
  const transcript = loadTranscript(row, dataDir);
  if (!transcript) return null;
  const t = transcript as NlpTranscript;
  const entities = extractEntities(t);
  const relationships = extractRelationships(t, entities);
  const result = { entities, relationships };
  nlpCache.set(row.videoId, result);
  return result;
}

export interface UiOptions {
  catalog: Catalog;
  dataDir?: string;
  port?: number;
  ingester?: Ingester;
}

export interface ListQuery {
  channel?: string;
  status?: string;
  notStatus?: string;
  text?: string;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  total: number;
  page: number;
  pageSize: number;
  rows: CatalogRow[];
}

export function filterRows(rows: CatalogRow[], q: ListQuery): CatalogRow[] {
  const needle = q.text?.toLowerCase();
  return rows.filter((r) => {
    if (q.channel && r.channel !== q.channel) return false;
    if (q.status && r.status !== q.status) return false;
    if (q.notStatus && r.status === q.notStatus) return false;
    if (needle) {
      const hay = `${r.title ?? ""} ${r.videoId} ${r.channel ?? ""} ${(r.keywords ?? []).join(" ")} ${r.description ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function paginate(rows: CatalogRow[], q: ListQuery): ListResult {
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, rows: rows.slice(start, start + pageSize) };
}

export interface LoadedTranscript {
  videoId: string;
  language?: string;
  kind?: string;
  cues: Array<{ start: number; duration: number; text: string }>;
}

export function loadTranscript(
  row: CatalogRow,
  dataDir?: string,
): LoadedTranscript | null {
  const path = row.transcriptPath ?? transcriptPath(row.videoId, dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function searchTranscriptLines(
  transcript: LoadedTranscript | null,
  needle: string,
): Array<{ start: number; text: string }> {
  if (!transcript?.cues) return [];
  const n = needle.toLowerCase();
  return transcript.cues
    .filter((c) => c.text.toLowerCase().includes(n))
    .map((c) => ({ start: c.start, text: c.text }));
}

export function deepLink(videoId: string, startSec: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(startSec)}s`;
}

export function renderListPage(result: ListResult, q: ListQuery): string {
  const rowsHtml = result.rows
    .map(
      (r) => `
    <tr>
      <td><a href="/video/${escapeHtml(r.videoId)}">${escapeHtml(r.videoId)}</a></td>
      <td>${escapeHtml(r.title ?? "")}</td>
      <td>${escapeHtml(r.channel ?? "")}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.fetchedAt ?? "")}</td>
    </tr>`,
    )
    .join("");
  if (result.total === 0) {
    return layout("captions — catalog", searchBar(q) + "<p>No videos match.</p>");
  }
  return layout(
    "captions — catalog",
    `${searchBar(q)}
    <p>${result.total} videos (page ${result.page})</p>
    <table><thead><tr><th>id</th><th>title</th><th>channel</th><th>status</th><th>fetched</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>`,
  );
}

export function renderDetailPage(
  row: CatalogRow,
  transcript: LoadedTranscript | null,
): string {
  if (!transcript) {
    return layout(
      `captions — ${row.videoId}`,
      `<h1>${escapeHtml(row.videoId)}</h1><p>No transcript on disk yet (status: ${escapeHtml(row.status)}).</p>`,
    );
  }
  const cues = transcript.cues ?? [];
  const lines = cues
    .map(
      (c) =>
        `<li><a href="${escapeHtml(deepLink(row.videoId, c.start))}" target="_blank">[${formatTime(c.start)}]</a> ${escapeHtml(c.text)}</li>`,
    )
    .join("");
  return layout(
    `captions — ${row.videoId}`,
    `<h1>${escapeHtml(row.title ?? row.videoId)}</h1>
    <p>channel: ${escapeHtml(row.channel ?? "")} · status: ${escapeHtml(row.status)}</p>
    <ol>${lines}</ol>`,
  );
}

export function renderEmptyState(reason: "empty" | "error" | "loading", msg?: string): string {
  const map = {
    empty: "No videos in catalog.",
    loading: "Loading…",
    error: `Error: ${msg ?? "unknown"}`,
  };
  return layout("captions", `<p>${escapeHtml(map[reason])}</p>`);
}

function searchBar(q: ListQuery): string {
  return `<form method="get">
    <input name="text" value="${escapeHtml(q.text ?? "")}" placeholder="search"/>
    <input name="channel" value="${escapeHtml(q.channel ?? "")}" placeholder="channel"/>
    <select name="status">
      <option value="">any status</option>
      ${["pending", "fetched", "failed-retryable", "failed-needs-user"]
        .map(
          (s) =>
            `<option value="${s}"${q.status === s ? " selected" : ""}>${s}</option>`,
        )
        .join("")}
    </select>
    <button>search</button>
  </form>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
  <style>body{font-family:system-ui;max-width:900px;margin:2em auto;padding:0 1em}
  table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:4px;text-align:left}
  form{display:flex;gap:.5em;margin-bottom:1em}ol{padding-left:1.2em}</style></head>
  <body><header><a href="/">catalog</a></header>${body}</body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTime(sec: number): string {
  const s = Math.floor(sec);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function parseQuery(url: string): ListQuery {
  const u = new URL(url, "http://local");
  const q: ListQuery = {};
  const text = u.searchParams.get("text");
  const channel = u.searchParams.get("channel");
  const status = u.searchParams.get("status");
  const page = u.searchParams.get("page");
  if (text) q.text = text;
  if (channel) q.channel = channel;
  if (status) q.status = status;
  const notStatus = u.searchParams.get("notStatus");
  if (notStatus) q.notStatus = notStatus;
  const pageSize = u.searchParams.get("pageSize");
  if (pageSize) q.pageSize = Number(pageSize);
  if (page) q.page = Number(page);
  return q;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function handle(req: IncomingMessage, res: ServerResponse, opts: UiOptions): void {
  const url = req.url ?? "/";
  try {
    // JSON API for the SPA.
    if (url.startsWith("/api/catalog")) {
      const q = parseQuery(url);
      const allRows = opts.catalog.all();
      const filtered = filterRows(allRows, q);
      if (q.text) {
        const needle = q.text.toLowerCase();
        const have = new Set(filtered.map((r) => r.videoId));
        for (const row of allRows) {
          if (have.has(row.videoId)) continue;
          if (row.status !== "fetched") continue;
          if (q.channel && row.channel !== q.channel) continue;
          if (q.status && row.status !== q.status) continue;
          if (q.notStatus && row.status === q.notStatus) continue;
          const nlp = computeNlp(row, opts.dataDir);
          if (!nlp) continue;
          if (nlp.entities.some((e) => e.canonical.toLowerCase().includes(needle))) {
            filtered.push(row);
          }
        }
      }
      filtered.sort((a, b) => {
        const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
        const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return ta - tb;
      });
      sendJson(res, 200, paginate(filtered, q));
      return;
    }
    if (url === "/api/livereload") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`retry: 500\n\n`);
      res.write(`event: hello\ndata: ok\n\n`);
      const keepalive = setInterval(() => res.write(`: ping\n\n`), 15000);
      req.on("close", () => clearInterval(keepalive));
      return;
    }
    if (url.startsWith("/api/progress")) {
      const progress: IngestProgress = opts.ingester?.snapshot() ?? {
        running: false,
        total: 0,
        done: 0,
        failed: 0,
      };
      sendJson(res, 200, progress);
      return;
    }
    const apiNlp = url.match(/^\/api\/video\/([A-Za-z0-9_-]+)\/nlp/);
    if (apiNlp) {
      const row = opts.catalog.get(apiNlp[1]);
      if (!row) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const nlp = computeNlp(row, opts.dataDir);
      sendJson(res, 200, nlp ?? { entities: [], relationships: [] });
      return;
    }
    if (url.startsWith("/api/entities/search")) {
      const u = new URL(url, "http://local");
      const q = (u.searchParams.get("q") || "").trim().toLowerCase();
      const type = u.searchParams.get("type") || "";
      const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") || 50)));
      const index = getEntityIndex(opts.catalog, opts.dataDir);
      let results = index;
      if (type) results = results.filter((e) => e.type === type);
      if (q) results = results.filter((e) => e.canonical.toLowerCase().includes(q));
      results = results
        .slice()
        .sort((a, b) => {
          if (q) {
            const ai = a.canonical.toLowerCase().indexOf(q);
            const bi = b.canonical.toLowerCase().indexOf(q);
            if (ai !== bi) return ai - bi;
          }
          if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
          return a.canonical.localeCompare(b.canonical);
        })
        .slice(0, limit);
      sendJson(res, 200, { total: results.length, results });
      return;
    }
    if (url.startsWith("/api/entity/")) {
      const u = new URL(url, "http://local");
      const entityId = decodeURIComponent(u.pathname.slice("/api/entity/".length));
      if (!entityId) {
        sendJson(res, 400, { error: "missing entity id" });
        return;
      }
      const videos: Array<{
        videoId: string;
        title?: string;
        channel?: string;
        publishDate?: string;
        thumbnailUrl?: string;
        mentions: TranscriptSpan[];
      }> = [];
      let entity: Entity | null = null;
      for (const row of opts.catalog.all()) {
        if (row.status !== "fetched") continue;
        const nlp = computeNlp(row, opts.dataDir);
        if (!nlp) continue;
        const match = nlp.entities.find((e) => e.id === entityId);
        if (!match) continue;
        if (!entity) entity = { ...match, mentions: [] };
        videos.push({
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          publishDate: row.publishDate,
          thumbnailUrl: row.thumbnailUrl,
          mentions: match.mentions,
        });
      }
      videos.sort((a, b) => {
        const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
        const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
      sendJson(res, 200, { entityId, entity, videos });
      return;
    }
    const apiVideo = url.match(/^\/api\/video\/([A-Za-z0-9_-]+)/);
    if (apiVideo) {
      const row = opts.catalog.get(apiVideo[1]);
      if (!row) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const transcript = loadTranscript(row, opts.dataDir);
      sendJson(res, 200, { row, transcript });
      return;
    }
    if (url === "/api/ingest/start" && req.method === "POST") {
      if (opts.ingester) void opts.ingester.start();
      sendJson(res, 202, { started: true });
      return;
    }
    if (url === "/api/catalog/reset-failed" && req.method === "POST") {
      const reset = opts.catalog.resetFailed();
      if (reset > 0 && opts.ingester) void opts.ingester.start();
      sendJson(res, 200, { reset });
      return;
    }

    if (url === "/client.js") {
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        const body = readFileSync(join(here, "client", "app.js"), "utf8");
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(body);
      } catch (e) {
        res.writeHead(500);
        res.end("client.js: " + (e as Error).message);
      }
      return;
    }

    // SPA shell + legacy HTML routes (kept for non-JS clients / tests).
    if (url === "/" || url.startsWith("/?") || url === "/admin" || url.startsWith("/admin?")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderSpaShell());
      return;
    }
    const m = url.match(/^\/video\/([A-Za-z0-9_-]+)/);
    if (m) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderSpaShell());
      return;
    }
    if (url.startsWith("/entity/")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderSpaShell());
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
  }
}

export function startUi(opts: UiOptions): { close: () => Promise<void> } {
  const server = createServer((req, res) => handle(req, res, opts));
  server.listen(opts.port ?? 4173);
  return {
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}
