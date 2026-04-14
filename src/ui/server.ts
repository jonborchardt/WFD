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
import { Catalog, CatalogRow, parseIdList } from "../catalog/catalog.js";
import { transcriptPath } from "../ingest/transcript.js";
import { limitedFetch } from "../ingest/rate-limiter.js";
import { renderSpaShell } from "./spa-shell.js";
import { extract as extractEntities, Transcript as NlpTranscript } from "../nlp/entities.js";
import { extractRelationships } from "../nlp/relationships.js";
import { Entity, Relationship } from "../shared/types.js";
import { CREDIT_FOOTER } from "../shared/credit-footer.js";
import {
  EntityIndexEntry,
  EntityVideosIndex,
  readPersistedEntityIndex,
  readPersistedEntityVideos,
  readPersistedNlp,
  writePersistedEntityIndex,
  writePersistedEntityVideos,
  writePersistedNlp,
} from "../nlp/persist.js";
import {
  filterRows as qFilterRows,
  augmentWithEntityMatches,
  sortByPublishDesc,
  paginate as qPaginate,
  searchEntityIndex,
} from "./query.js";
import type { ListQuery, ListResult } from "./query.js";

interface NlpResult {
  entities: Entity[];
  relationships: Relationship[];
}

// Channels we watch for upstream drift. YouTube exposes the 15 most recent
// uploads as an unauthenticated Atom feed, which is enough to detect "there
// is a new video we haven't pulled yet". If we outgrow a single channel,
// promote this to catalog config.
const WATCHED_CHANNELS: { id: string; label: string }[] = [
  { id: "UCIFk2uvCNcEmZ77g0ESKLcQ", label: "The Why Files" },
];

interface UpstreamVideo {
  videoId: string;
  title: string;
  publishedAt: string;
}

interface UpstreamCheck {
  channelId: string;
  channelLabel: string;
  upstream: UpstreamVideo | null;
  catalog: { videoId: string; title?: string; publishDate?: string } | null;
  behind: boolean;
  error?: string;
}

const upstreamCache = new Map<string, { at: number; value: UpstreamVideo | null }>();
const UPSTREAM_TTL_MS = 10 * 60 * 1000;

async function fetchChannelLatest(channelId: string): Promise<UpstreamVideo | null> {
  const cached = upstreamCache.get(channelId);
  if (cached && Date.now() - cached.at < UPSTREAM_TTL_MS) return cached.value;
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const r = await limitedFetch(url);
  if (!r.ok) throw new Error(`feed fetch failed: ${r.status}`);
  const xml = await r.text();
  const entry = xml.match(/<entry>[\s\S]*?<\/entry>/);
  if (!entry) {
    upstreamCache.set(channelId, { at: Date.now(), value: null });
    return null;
  }
  const body = entry[0];
  const videoId = body.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
  const title = body.match(/<title>([^<]+)<\/title>/)?.[1];
  const publishedAt = body.match(/<published>([^<]+)<\/published>/)?.[1];
  if (!videoId || !title || !publishedAt) {
    upstreamCache.set(channelId, { at: Date.now(), value: null });
    return null;
  }
  const value: UpstreamVideo = { videoId, title, publishedAt };
  upstreamCache.set(channelId, { at: Date.now(), value });
  return value;
}

function latestCatalogRowForChannel(catalog: Catalog, channelId: string): CatalogRow | null {
  let best: CatalogRow | null = null;
  let bestT = -Infinity;
  for (const r of catalog.all()) {
    if (r.channelId !== channelId) continue;
    const t = r.publishDate ? Date.parse(r.publishDate) : NaN;
    if (isNaN(t)) continue;
    if (t > bestT) { bestT = t; best = r; }
  }
  return best;
}

async function checkUpstream(catalog: Catalog): Promise<UpstreamCheck[]> {
  const out: UpstreamCheck[] = [];
  for (const ch of WATCHED_CHANNELS) {
    const catalogRow = latestCatalogRowForChannel(catalog, ch.id);
    try {
      const upstream = await fetchChannelLatest(ch.id);
      let behind = false;
      if (upstream) {
        if (!catalogRow) behind = true;
        else if (catalogRow.videoId !== upstream.videoId) {
          const upT = Date.parse(upstream.publishedAt);
          const catT = catalogRow.publishDate ? Date.parse(catalogRow.publishDate) : NaN;
          behind = isNaN(catT) || upT > catT;
        }
      }
      out.push({
        channelId: ch.id,
        channelLabel: ch.label,
        upstream,
        catalog: catalogRow ? {
          videoId: catalogRow.videoId,
          title: catalogRow.title,
          publishDate: catalogRow.publishDate,
        } : null,
        behind,
      });
    } catch (err) {
      out.push({
        channelId: ch.id,
        channelLabel: ch.label,
        upstream: null,
        catalog: catalogRow ? {
          videoId: catalogRow.videoId,
          title: catalogRow.title,
          publishDate: catalogRow.publishDate,
        } : null,
        behind: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

const nlpCache = new Map<string, NlpResult>();
let entityIndexCache: EntityIndexEntry[] | null = null;
let entityVideosCache: EntityVideosIndex | null = null;

function computeNlp(row: CatalogRow, dataDir?: string): NlpResult | null {
  const cached = nlpCache.get(row.videoId);
  if (cached) return cached;
  const persisted = readPersistedNlp(row.videoId, dataDir);
  if (persisted) {
    nlpCache.set(row.videoId, persisted);
    return persisted;
  }
  const transcript = loadTranscript(row, dataDir);
  if (!transcript) return null;
  const t = transcript as NlpTranscript;
  const entities = extractEntities(t);
  const relationships = extractRelationships(t, entities);
  const result = { entities, relationships };
  nlpCache.set(row.videoId, result);
  writePersistedNlp(row.videoId, result, dataDir);
  return result;
}

function buildNlpIndexes(
  catalog: Catalog,
  dataDir?: string,
): { index: EntityIndexEntry[]; videos: EntityVideosIndex } {
  const agg = new Map<string, EntityIndexEntry>();
  const videos: EntityVideosIndex = {};
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
      (videos[e.id] ||= []).push({ videoId: row.videoId, mentions: e.mentions });
    }
  }
  return { index: [...agg.values()], videos };
}

function getEntityIndex(catalog: Catalog, dataDir?: string): EntityIndexEntry[] {
  if (entityIndexCache) return entityIndexCache;
  const persisted = readPersistedEntityIndex(dataDir);
  if (persisted) {
    entityIndexCache = persisted;
    return persisted;
  }
  const built = buildNlpIndexes(catalog, dataDir);
  entityIndexCache = built.index;
  entityVideosCache = built.videos;
  writePersistedEntityIndex(built.index, dataDir);
  writePersistedEntityVideos(built.videos, dataDir);
  return built.index;
}

interface GraphNode {
  id: string;
  type: Entity["type"];
  canonical: string;
  weight: number;
}
interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  count: number;
}
interface RelationshipsGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
let relationshipsGraphCache: RelationshipsGraph | null = null;

function buildRelationshipsGraph(catalog: Catalog, dataDir?: string): RelationshipsGraph {
  if (relationshipsGraphCache) return relationshipsGraphCache;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const row of catalog.all()) {
    if (row.status !== "fetched") continue;
    const nlp = computeNlp(row, dataDir);
    if (!nlp) continue;
    const localEnts = new Map(nlp.entities.map((e) => [e.id, e]));
    for (const rel of nlp.relationships) {
      const s = localEnts.get(rel.subjectId);
      const o = localEnts.get(rel.objectId);
      if (!s || !o) continue;
      for (const ent of [s, o]) {
        const existing = nodes.get(ent.id);
        if (existing) existing.weight += 1;
        else nodes.set(ent.id, { id: ent.id, type: ent.type, canonical: ent.canonical, weight: 1 });
      }
      const key = `${rel.subjectId}|${rel.predicate}|${rel.objectId}`;
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, {
        id: key,
        source: rel.subjectId,
        target: rel.objectId,
        predicate: rel.predicate,
        count: 1,
      });
    }
  }
  relationshipsGraphCache = { nodes: [...nodes.values()], edges: [...edges.values()] };
  return relationshipsGraphCache;
}

function getEntityVideos(catalog: Catalog, dataDir?: string): EntityVideosIndex {
  if (entityVideosCache) return entityVideosCache;
  const persisted = readPersistedEntityVideos(dataDir);
  if (persisted) {
    entityVideosCache = persisted;
    return persisted;
  }
  const built = buildNlpIndexes(catalog, dataDir);
  entityIndexCache = built.index;
  entityVideosCache = built.videos;
  writePersistedEntityIndex(built.index, dataDir);
  writePersistedEntityVideos(built.videos, dataDir);
  return built.videos;
}

export interface UiOptions {
  catalog: Catalog;
  dataDir?: string;
  port?: number;
}

export type { ListQuery, ListResult };
export const filterRows = qFilterRows;
export const paginate = qPaginate;

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

// Surface the `_stale` marker that nlpStage stamps onto an AI response
// file when NLP is regenerated. Returns null when the response file does
// not exist or has no marker. Does not mutate the file.
export function readAiResponseStale(
  videoId: string,
  dataDir?: string,
): { since: string; reason: string; nlpAt?: string } | null {
  const root = dataDir ?? join(process.cwd(), "data");
  const p = join(root, "ai", "responses", `${videoId}.response.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const stale = raw._stale as
      | { since?: string; reason?: string; nlpAt?: string }
      | undefined;
    if (!stale?.since) return null;
    return {
      since: stale.since,
      reason: stale.reason ?? "nlp regenerated",
      nlpAt: stale.nlpAt,
    };
  } catch {
    return null;
  }
}

// Read-only NLP inspection page for /admin/nlp/<id>. Surfaces stage status,
// entities, relationships, and (if present) the `_stale` marker on the AI
// response so the operator can tell at a glance what's current.
export function renderNlpAdmin(
  row: CatalogRow,
  nlp: { entities: Entity[]; relationships: Relationship[] },
  aiResponseStale: { since: string; reason: string; nlpAt?: string } | null,
): string {
  const stageRows = (["fetched", "nlp", "per-claim", "ai"] as const)
    .map((name) => {
      const rec = row.stages?.[name];
      if (!rec) return `<tr><td>${name}</td><td>—</td><td>—</td></tr>`;
      return `<tr><td>${name}</td><td>${escapeHtml(rec.at)}</td><td>${escapeHtml(rec.notes ?? "")}</td></tr>`;
    })
    .join("");

  const sortedEntities = [...nlp.entities].sort((a, b) =>
    a.canonical.localeCompare(b.canonical),
  );
  const entityRows = sortedEntities
    .map((e) => {
      const first = e.mentions[0];
      const link = first
        ? `<a target="_blank" href="${escapeHtml(deepLink(row.videoId, first.timeStart))}">${formatTime(first.timeStart)}</a>`
        : "—";
      return `<tr>
        <td>${escapeHtml(e.type)}</td>
        <td>${escapeHtml(e.canonical)}</td>
        <td>${e.mentions.length}</td>
        <td>${link}</td>
        <td><code>${escapeHtml(e.id)}</code></td>
      </tr>`;
    })
    .join("");

  const relRows = nlp.relationships
    .map((r) => {
      const link = r.evidence
        ? `<a target="_blank" href="${escapeHtml(deepLink(row.videoId, r.evidence.timeStart))}">${formatTime(r.evidence.timeStart)}</a>`
        : "—";
      return `<tr>
        <td>${escapeHtml(r.subjectId)}</td>
        <td>${escapeHtml(r.predicate)}</td>
        <td>${escapeHtml(r.objectId)}</td>
        <td>${r.confidence.toFixed(2)}</td>
        <td>${escapeHtml(r.provenance)}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");

  const staleBanner = aiResponseStale
    ? `<div class="warn">
        ⚠ AI response marked stale since ${escapeHtml(aiResponseStale.since)} — ${escapeHtml(aiResponseStale.reason)}.
        Re-run <code>pipeline --stage ai</code> after regenerating its bundle to refresh.
      </div>`
    : "";

  const body = `
    <h1>NLP — ${escapeHtml(row.title ?? row.videoId)}</h1>
    <p>
      <a href="/video/${escapeHtml(row.videoId)}">video page</a> ·
      channel: ${escapeHtml(row.channel ?? "")} ·
      status: ${escapeHtml(row.status)} ·
      ${nlp.entities.length} entities · ${nlp.relationships.length} relationships
    </p>
    ${staleBanner}

    <h2>Stage status</h2>
    <table>
      <thead><tr><th>stage</th><th>at</th><th>notes</th></tr></thead>
      <tbody>${stageRows}</tbody>
    </table>

    <h2>Entities</h2>
    <table>
      <thead><tr><th>type</th><th>canonical</th><th>mentions</th><th>first</th><th>id</th></tr></thead>
      <tbody>${entityRows || "<tr><td colspan=5>none</td></tr>"}</tbody>
    </table>

    <h2>Relationships</h2>
    <table>
      <thead><tr><th>subject</th><th>predicate</th><th>object</th><th>conf</th><th>src</th><th>evidence</th></tr></thead>
      <tbody>${relRows || "<tr><td colspan=6>none</td></tr>"}</tbody>
    </table>

    <style>
      td code { font-size: 11px; color: #666; }
      .warn { background: #fee; border: 1px solid #c88; padding: .6em 1em; margin: 1em 0; }
    </style>
  `;
  return layout(`nlp — ${row.videoId}`, body);
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
  <body><header><a href="/">catalog</a></header>${body}${CREDIT_FOOTER}</body></html>`;
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
  if (u.searchParams.get("incompleteStages")) q.incompleteStages = true;
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
      const filtered = qFilterRows(allRows, q);
      if (q.text) {
        augmentWithEntityMatches(
          filtered,
          allRows,
          q,
          getEntityIndex(opts.catalog, opts.dataDir),
          getEntityVideos(opts.catalog, opts.dataDir),
        );
      }
      const sorted = sortByPublishDesc(filtered);
      sendJson(res, 200, qPaginate(sorted, q));
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
    if (url.startsWith("/api/admin/upstream-check")) {
      void checkUpstream(opts.catalog).then(
        (results) => sendJson(res, 200, { channels: results }),
        (err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }),
      );
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
    if (url === "/api/relationships" || url.startsWith("/api/relationships?")) {
      sendJson(res, 200, buildRelationshipsGraph(opts.catalog, opts.dataDir));
      return;
    }
    if (url.startsWith("/api/entities/search")) {
      const u = new URL(url, "http://local");
      const results = searchEntityIndex(
        getEntityIndex(opts.catalog, opts.dataDir),
        {
          q: u.searchParams.get("q") || "",
          type: u.searchParams.get("type") || "",
          limit: Number(u.searchParams.get("limit") || 50),
        },
      );
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
      const idx = getEntityIndex(opts.catalog, opts.dataDir).find((e) => e.id === entityId);
      const entity: Entity | null = idx
        ? { id: idx.id, type: idx.type, canonical: idx.canonical, aliases: [], mentions: [] }
        : null;
      const refs = getEntityVideos(opts.catalog, opts.dataDir)[entityId] || [];
      const videos = refs
        .map((ref) => {
          const row = opts.catalog.get(ref.videoId);
          if (!row) return null;
          return {
            videoId: row.videoId,
            title: row.title,
            channel: row.channel,
            publishDate: row.publishDate,
            thumbnailUrl: row.thumbnailUrl,
            mentions: ref.mentions,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .sort((a, b) => {
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
    // Add-video entrypoint. Mirrors `captions add` from the CLI: seeds a row
    // in the catalog from a url/id passed as ?url=. Fetching happens out of
    // band via `npm run ingest` / `npm run pipeline`; the UI is read-only.
    if (url.startsWith("/api/add") && req.method === "POST") {
      const u = new URL(url, "http://localhost");
      const raw = u.searchParams.get("url") ?? "";
      const parsed = parseIdList(raw);
      if (parsed.length === 0) {
        sendJson(res, 400, { error: "could not parse youtube url or id" });
        return;
      }
      const added = opts.catalog.seed(parsed);
      sendJson(res, 200, {
        added,
        videoId: parsed[0].videoId,
        alreadyPresent: added === 0,
      });
      return;
    }
    if (url === "/api/catalog/reset-failed" && req.method === "POST") {
      const reset = opts.catalog.resetFailed();
      sendJson(res, 200, { reset });
      return;
    }

    const staticAsset: Record<string, string> = {
      "/client.js": join(dirname(fileURLToPath(import.meta.url)), "client", "app.js"),
      "/query.js": join(dirname(fileURLToPath(import.meta.url)), "query.js"),
      "/static-shim.js": join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "scripts",
        "static-shim.js",
      ),
    };
    if (staticAsset[url]) {
      try {
        const body = readFileSync(staticAsset[url], "utf8");
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(body);
      } catch (e) {
        res.writeHead(500);
        res.end(`${url}: ` + (e as Error).message);
      }
      return;
    }

    // SPA shell + legacy HTML routes (kept for non-JS clients / tests).
    if (url === "/" || url.startsWith("/?") || url === "/admin" || url.startsWith("/admin?")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderSpaShell());
      return;
    }
    // Read-only NLP inspection page. Pure HTML, no SPA bundle, no editing —
    // hand-editing NER output is not supported, and downstream refinements
    // live in the ai stage's bundles/responses on disk.
    const adminNlp = url.match(/^\/admin\/nlp\/([A-Za-z0-9_-]+)/);
    if (adminNlp) {
      const row = opts.catalog.get(adminNlp[1]);
      if (!row) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end(layout("not found", `<p>no such video: ${escapeHtml(adminNlp[1])}</p>`));
        return;
      }
      const nlp = computeNlp(row, opts.dataDir) ?? {
        entities: [],
        relationships: [],
      };
      const aiResponseStale = readAiResponseStale(row.videoId, opts.dataDir);
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderNlpAdmin(row, nlp, aiResponseStale));
      return;
    }
    const m = url.match(/^\/video\/([A-Za-z0-9_-]+)/);
    if (m) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderSpaShell());
      return;
    }
    if (url === "/relationships" || url.startsWith("/relationships?")) {
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
