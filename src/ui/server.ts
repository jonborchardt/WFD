// Local navigation UI.
//
// UI stack rationale: a zero-dependency node:http server that renders vanilla
// HTML and serves JSON from the catalog + transcripts on disk. We deliberately
// avoid a frontend framework here: everything lives on the local machine, the
// catalog is small, and we want the CLI to start this with no build step.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Catalog, CatalogRow, parseIdList } from "../catalog/catalog.js";
import { transcriptPath } from "../ingest/transcript.js";
import { limitedFetch } from "../ingest/rate-limiter.js";

import { Entity, Relationship } from "../shared/types.js";
import { CREDIT_FOOTER } from "../shared/credit-footer.js";
import {
  EntityIndexEntry,
  EntityVideosIndex,
  readPersistedEntityIndex,
  readPersistedEntityVideos,
  writePersistedEntityIndex,
  writePersistedEntityVideos,
} from "../graph/entity-index-persist.js";
import { neuralToGraph } from "../graph/adapt.js";
import {
  buildCorpusEntities,
  buildMergeClusters,
  classifyClusters,
  readAliases,
  recordReview,
  writeAliases,
  notSameKey,
  isSentinel,
  isDeleted,
  resolveKey,
  entityKeyOf,
  SENTINEL_DELETED,
} from "../graph/canonicalize.js";
import {
  addClaimTruthOverride,
  removeClaimTruthOverride,
  addClaimDeletion,
  removeClaimDeletion,
} from "../graph/aliases-schema.js";
import {
  readPersistedEntities,
  type PersistedEntities,
} from "../entities/index.js";
import {
  readPersistedRelations,
  type PersistedRelations,
} from "../relations/index.js";
import { readPersistedDerivedDates } from "../date_normalize/index.js";
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

// Read the per-video neural output (entities + relations), adapt it
// into the legacy {entities, relationships} shape every downstream
// consumer expects, and cache it. Returns null if the entities stage
// has not been run for this video yet.
function computeNlp(row: CatalogRow, dataDir?: string): NlpResult | null {
  const cached = nlpCache.get(row.videoId);
  if (cached) return cached;
  const root = dataDir ?? join(process.cwd(), "data");
  const persistedEntities = readPersistedEntities(row.videoId, root);
  if (!persistedEntities) return null;
  const persistedRelations = readPersistedRelations(row.videoId, root);
  const derivedDates = readPersistedDerivedDates(row.videoId, root);
  const { entities, relationships } = neuralToGraph(
    persistedEntities,
    persistedRelations,
    undefined,
    derivedDates,
  );
  const result: NlpResult = { entities, relationships };
  nlpCache.set(row.videoId, result);
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
  // The indexesStage pre-builds this file during each pipeline run,
  // so we read from disk instead of recomputing from 200+ per-video
  // entity/relations files — that recomputation blocked the HTTP
  // response for 30+ seconds on large corpora.
  const root = dataDir ?? join(process.cwd(), "data");
  const prebuilt = join(root, "graph", "relationships-graph.json");
  if (existsSync(prebuilt)) {
    try {
      const raw = JSON.parse(readFileSync(prebuilt, "utf8")) as RelationshipsGraph;
      relationshipsGraphCache = raw;
      return raw;
    } catch {
      // Fall through to on-demand build.
    }
  }
  // Fallback: build on demand if the pre-built file doesn't exist yet
  // (first run before indexesStage has fired).
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

// ---------------------------------------------------------------------------
// Indexed graph — lazy-built from the pre-built relationships graph so
// search / neighbor / connections queries are O(1) lookups instead of
// full scans over 9k+ nodes / 24k+ edges.
// ---------------------------------------------------------------------------
interface IndexedGraph {
  nodeMap: Map<string, GraphNode>;
  /** adjacency: nodeId → array of { neighbor node, edge } */
  adj: Map<string, Array<{ node: GraphNode; edge: GraphEdge }>>;
}
let indexedGraphCache: IndexedGraph | null = null;

function getIndexedGraph(catalog: Catalog, dataDir?: string): IndexedGraph {
  if (indexedGraphCache) return indexedGraphCache;
  const g = buildRelationshipsGraph(catalog, dataDir);
  const nodeMap = new Map<string, GraphNode>();
  for (const n of g.nodes) nodeMap.set(n.id, n);
  const adj = new Map<string, Array<{ node: GraphNode; edge: GraphEdge }>>();
  for (const e of g.edges) {
    const sNode = nodeMap.get(e.source);
    const tNode = nodeMap.get(e.target);
    if (!sNode || !tNode) continue;
    let sList = adj.get(e.source);
    if (!sList) { sList = []; adj.set(e.source, sList); }
    sList.push({ node: tNode, edge: e });
    let tList = adj.get(e.target);
    if (!tList) { tList = []; adj.set(e.target, tList); }
    tList.push({ node: sNode, edge: e });
  }
  // Sort each adjacency list by edge count desc so "top N" is just a slice.
  for (const list of adj.values()) {
    list.sort((a, b) => b.edge.count - a.edge.count);
  }
  indexedGraphCache = { nodeMap, adj };
  return indexedGraphCache;
}

function graphSearch(
  catalog: Catalog,
  query: string,
  limit: number,
  dataDir?: string,
): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { nodeMap } = getIndexedGraph(catalog, dataDir);
  const hits: Array<{ node: GraphNode; score: number }> = [];
  for (const n of nodeMap.values()) {
    const c = n.canonical.toLowerCase();
    if (c === q) hits.push({ node: n, score: 100 + n.weight });
    else if (c.startsWith(q)) hits.push({ node: n, score: 50 + n.weight });
    else if (c.includes(q)) hits.push({ node: n, score: 10 + n.weight });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => h.node);
}

interface NeighborResult {
  node: GraphNode;
  neighbors: GraphNode[];
  edges: GraphEdge[];
  total: number;
}

function graphNeighbors(
  catalog: Catalog,
  nodeId: string,
  offset: number,
  limit: number,
  dataDir?: string,
): NeighborResult | null {
  const { nodeMap, adj } = getIndexedGraph(catalog, dataDir);
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  const list = adj.get(nodeId) ?? [];
  const slice = list.slice(offset, offset + limit);
  return {
    node,
    neighbors: slice.map((s) => s.node),
    edges: slice.map((s) => s.edge),
    total: list.length,
  };
}

interface ConnectionsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function graphConnections(
  catalog: Catalog,
  nodeIds: string[],
  dataDir?: string,
): ConnectionsResult {
  const { nodeMap, adj } = getIndexedGraph(catalog, dataDir);
  const idSet = new Set(nodeIds);
  const nodes: GraphNode[] = [];
  for (const id of idSet) {
    const n = nodeMap.get(id);
    if (n) nodes.push(n);
  }
  // Find all edges where both endpoints are in the requested set.
  const edgesSeen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const id of idSet) {
    for (const entry of adj.get(id) ?? []) {
      const otherId = entry.edge.source === id ? entry.edge.target : entry.edge.source;
      if (idSet.has(otherId) && !edgesSeen.has(entry.edge.id)) {
        edgesSeen.add(entry.edge.id);
        edges.push(entry.edge);
      }
    }
  }
  return { nodes, edges };
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
      <td><a href="/WFD/video/${escapeHtml(r.videoId)}">${escapeHtml(r.videoId)}</a></td>
      <td>${escapeHtml(r.title ?? "")}</td>
      <td>${escapeHtml(r.channel ?? "")}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.stages?.fetched?.at ?? "")}</td>
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

// Unified per-video admin page. Shows neural entities and relations on
// one screen, with a troubleshooting section at the bottom describing
// how to respond to common quality issues. Tables are sortable client
// side via the inline script wired up by layout().
export function renderUnifiedVideoAdmin(
  row: CatalogRow,
  neuralEntities: PersistedEntities | null,
  neuralRelations: PersistedRelations | null,
  aiResponseStale: { since: string; reason: string; nlpAt?: string } | null,
): string {
  const stageRows = (["fetched", "entities", "relations", "ai", "per-claim"] as const)
    .map((name) => {
      const rec = row.stages?.[name];
      if (!rec) {
        return `<tr><td>${name}</td><td data-sort-value="">—</td><td>—</td></tr>`;
      }
      return `<tr><td>${name}</td><td data-sort-value="${escapeHtml(rec.at)}">${escapeHtml(rec.at)}</td><td>${escapeHtml(rec.notes ?? "")}</td></tr>`;
    })
    .join("");

  const neuralEntityRows = neuralEntities
    ? neuralEntities.mentions
        .map((m) => {
          const link = `<a target="_blank" href="${escapeHtml(deepLink(row.videoId, m.span.timeStart))}">${formatTime(m.span.timeStart)}</a>`;
          const entityKey = entityKeyOf(m.label, m.canonical);
          const canonicalLink = `<a href="/admin/entity/${escapeHtml(encodeURIComponent(entityKey))}">${escapeHtml(m.canonical)}</a>`;
          const actions = `<span class="entity-actions" data-entity-key="${escapeHtml(entityKey)}" data-entity-label="${escapeHtml(m.label)}" data-entity-canonical="${escapeHtml(m.canonical)}" data-video-id="${escapeHtml(row.videoId)}"><button class="entity-menu-toggle" onclick="openEntityMenu(this)" title="entity actions" style="border:none;background:none;cursor:pointer;padding:0 4px">⋯</button></span>`;
          return `<tr>
            <td>${escapeHtml(m.label)}</td>
            <td>${canonicalLink} ${actions}</td>
            <td>${escapeHtml(m.surface)}</td>
            <td data-sort-value="${m.score}">${m.score.toFixed(2)}</td>
            <td data-sort-value="${m.span.timeStart}">${link}</td>
          </tr>`;
        })
        .join("")
    : "";

  const mentionById = new Map(
    (neuralEntities?.mentions ?? []).map((m) => [m.id, m]),
  );
  const neuralRelRows = neuralRelations
    ? neuralRelations.edges
        .map((e) => {
          const subj = mentionById.get(e.subjectMentionId);
          const obj = mentionById.get(e.objectMentionId);
          const link = `<a target="_blank" href="${escapeHtml(deepLink(row.videoId, e.evidence.timeStart))}">${formatTime(e.evidence.timeStart)}</a>`;
          const subjectKey = subj ? entityKeyOf(subj.label, subj.canonical) : e.subjectMentionId;
          const objectKey = obj ? entityKeyOf(obj.label, obj.canonical) : e.objectMentionId;
          const subjectText = subj?.canonical ?? e.subjectMentionId;
          const objectText = obj?.canonical ?? e.objectMentionId;
          const relActions = `<span class="relation-actions" data-video-id="${escapeHtml(row.videoId)}" data-subject-key="${escapeHtml(subjectKey)}" data-predicate="${escapeHtml(e.predicate)}" data-object-key="${escapeHtml(objectKey)}" data-time-start="${e.evidence.timeStart}" data-subject-text="${escapeHtml(subjectText)}" data-object-text="${escapeHtml(objectText)}"><button class="rel-menu-toggle" onclick="openRelationMenu(this)" title="relationship actions" style="border:none;background:none;cursor:pointer;padding:0 4px">✎</button></span>`;
          return `<tr>
            <td>${escapeHtml(subjectText)}</td>
            <td>${escapeHtml(e.predicate)}</td>
            <td>${escapeHtml(objectText)}</td>
            <td data-sort-value="${e.score}">${e.score.toFixed(2)}</td>
            <td data-sort-value="${e.evidence.timeStart}">${link} ${relActions}</td>
          </tr>`;
        })
        .join("")
    : "";

  const staleBanner = aiResponseStale
    ? `<div class="warn">
        ⚠ AI response marked stale since ${escapeHtml(aiResponseStale.since)} — ${escapeHtml(aiResponseStale.reason)}.
      </div>`
    : "";

  const neuralStatus = neuralEntities
    ? `${neuralEntities.mentions.length} mentions · model ${escapeHtml(neuralEntities.model)} · coref=${neuralEntities.corefApplied}`
    : `<em>no data/entities/${escapeHtml(row.videoId)}.json — run <code>captions entities --video ${escapeHtml(row.videoId)}</code></em>`;
  const neuralRelStatus = neuralRelations
    ? `${neuralRelations.edges.length} edges · model ${escapeHtml(neuralRelations.model)}`
    : `<em>no data/relations/${escapeHtml(row.videoId)}.json — run <code>captions relations --video ${escapeHtml(row.videoId)}</code></em>`;

  const troubleshooting = `
    <details>
      <summary>Troubleshooting &amp; tuning — what to do if…</summary>
      <p>Knobs live in <code>config/models.json</code>, <code>config/entity-labels.json</code>, and <code>config/relation-labels.json</code>. Re-run with <code>captions neural --video ${escapeHtml(row.videoId)}</code> after any change.</p>
      <table>
        <thead><tr><th>Symptom</th><th>Fix</th></tr></thead>
        <tbody>
          <tr><td>Too many noisy relations overall</td><td>Raise per-predicate thresholds in <code>config/relation-labels.json</code> (0.3 → 0.35 or 0.4)</td></tr>
          <tr><td>Specific predicates are garbage (e.g. <code>died_in</code>, <code>caused</code>)</td><td>Raise just those thresholds; leave reliable ones (<code>located_in</code>, <code>part_of</code>) alone</td></tr>
          <tr><td>Transcript artifacts like <code>[Music]</code> or <code>[Applause]</code> extracted as entities</td><td>Add them to <code>PRONOUN_STOPWORDS</code> in <code>src/entities/canonicalize.ts</code></td></tr>
          <tr><td>Generic common nouns (<code>channel</code>, <code>house</code>, <code>scientists</code>) firing as person/org</td><td>Raise <code>gliner.minScore</code> in <code>config/models.json</code> from 0.5 → 0.6 or 0.7</td></tr>
          <tr><td>Zero relations and the log shows “0 raw preds” across every sentence</td><td>Lower <code>glirel.minScore</code> to 0.1 and rerun with <code>CAPTIONS_PY_DEBUG=1</code> to inspect raw scores</td></tr>
          <tr><td>Relations are correct but thin (few edges from many entities)</td><td>Increase the relation-window size in <code>src/relations/extract.ts</code> (<code>RELATION_WINDOW_CHARS</code>) or bump <code>glirel.maxPairsPerSentence</code></td></tr>
          <tr><td>Entities concentrated near the start of the transcript only</td><td>Auto-gen transcript truncation — lower <code>TARGET_CHUNK_CHARS</code> in <code>tools/gliner_sidecar.py</code> (currently 800)</td></tr>
          <tr><td>Pronouns (<code>I</code>, <code>he</code>, <code>you</code>) showing up as entities</td><td>Already filtered in <code>src/entities/canonicalize.ts</code>; check the <code>PRONOUN_STOPWORDS</code> set hasn't been modified</td></tr>
          <tr><td>Self-loops (same canonical on both sides of a relation)</td><td>Already filtered in <code>src/relations/extract.ts</code>; shouldn't appear</td></tr>
          <tr><td>Labels firing for wrong categories (e.g. dates tagged as persons)</td><td>Drop those labels from <code>config/entity-labels.json</code> or narrow to the ones that actually fit this corpus</td></tr>
          <tr><td>Entity coref broken (pronoun resolution)</td><td>Install <code>fastcoref</code> with a compatible <code>transformers</code> version (&lt;4.48), then flip <code>coref.enabled: true</code> in <code>config/models.json</code></td></tr>
        </tbody>
      </table>
    </details>
  `;

  const body = `
    <h1>${escapeHtml(row.title ?? row.videoId)}</h1>
    <p>
      <code>${escapeHtml(row.videoId)}</code> ·
      <a href="/WFD/video/${escapeHtml(row.videoId)}">public video page</a> ·
      channel: ${escapeHtml(row.channel ?? "")} ·
      status: ${escapeHtml(row.status)}
    </p>
    ${staleBanner}

    <h2>Stage status</h2>
    <table class="sortable">
      <thead><tr><th>stage</th><th data-sort-type="date">at</th><th>notes</th></tr></thead>
      <tbody>${stageRows}</tbody>
    </table>

    <h2>Neural entities <span class="sub">${neuralStatus}</span></h2>
    <table class="sortable">
      <thead>
        <tr>
          <th>label</th>
          <th>canonical</th>
          <th>surface</th>
          <th data-sort-type="number">score</th>
          <th data-sort-type="number">first</th>
        </tr>
      </thead>
      <tbody>${neuralEntityRows || '<tr><td colspan="5">none</td></tr>'}</tbody>
    </table>

    <h2>Neural relations <span class="sub">${neuralRelStatus}</span></h2>
    <table class="sortable">
      <thead>
        <tr>
          <th>subject</th>
          <th>predicate</th>
          <th>object</th>
          <th data-sort-type="number">score</th>
          <th data-sort-type="number">evidence</th>
        </tr>
      </thead>
      <tbody>${neuralRelRows || '<tr><td colspan="5">none</td></tr>'}</tbody>
    </table>

    ${troubleshooting}
  `;
  return layout(`video admin — ${row.videoId}`, body);
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

// Shared inline stylesheet. Kept vanilla-HTML so the plain-text admin
// pages render identically with no JS. The Material-styled React SPA
// pages use their own tree; this sheet just makes sure the HTML pages
// look intentional next to them.
const PAGE_STYLE = `
  :root{--fg:#111;--muted:#666;--bg:#fff;--accent:#1976d2;--border:#e0e0e0;--good:#2e7d32;--warn:#ed6c02;--bad:#c62828}
  body{font-family:system-ui,-apple-system,sans-serif;color:var(--fg);background:var(--bg);max-width:1100px;margin:0 auto;padding:1em}
  header{display:flex;align-items:center;gap:1em;padding:.6em 0;border-bottom:1px solid var(--border);margin-bottom:1em;font-size:14px}
  header a{color:var(--accent);text-decoration:none}
  header a:hover{text-decoration:underline}
  h1{font-size:22px;margin:.8em 0 .2em}
  h2{font-size:16px;margin:1.6em 0 .4em;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  h2 .sub{font-size:12px;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;margin-left:.6em}
  p{margin:.3em 0;color:var(--muted);font-size:13px}
  p a{color:var(--accent);text-decoration:none}
  p a:hover{text-decoration:underline}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:1em}
  th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#fafafa;font-weight:600;color:var(--fg);position:sticky;top:0}
  table.sortable th{cursor:pointer;user-select:none}
  table.sortable th::after{content:" \\2195";opacity:.25;font-size:11px}
  table.sortable th.asc::after{content:" \\25B2";opacity:1}
  table.sortable th.desc::after{content:" \\25BC";opacity:1}
  td code{font-size:11px;color:var(--muted);background:#f5f5f5;padding:1px 4px;border-radius:2px}
  .pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:#eee;color:var(--muted)}
  .pill.ok{background:#e8f5e9;color:var(--good)}
  .pill.warn{background:#fff4e5;color:var(--warn)}
  .pill.bad{background:#ffebee;color:var(--bad)}
  .warn{background:#fff4e5;border:1px solid #ffcc80;padding:.6em 1em;margin:1em 0;border-radius:4px;color:var(--warn)}
  details{margin-top:2em;border-top:1px solid var(--border);padding-top:1em}
  details summary{cursor:pointer;font-weight:600;color:var(--fg);padding:.4em 0}
  details table{font-size:12px}
  details th,details td{padding:4px 8px}
  form{display:flex;gap:.5em;margin-bottom:1em}
  ol{padding-left:1.2em}
`;

// Minimal client-side script to make any <table class="sortable"> sort
// when headers are clicked. Reads data-sort-type from th ("number"|
// "string"|"date") and data-sort-value from td for custom ordering
// (e.g. format display values while sorting on raw numbers).
const SORTABLE_SCRIPT = `
(function(){
  function getVal(cell, type){
    var raw = cell.getAttribute('data-sort-value');
    if (raw === null) raw = cell.textContent.trim();
    if (type === 'number') { var n = parseFloat(raw); return isNaN(n) ? -Infinity : n; }
    if (type === 'date')   { var d = Date.parse(raw); return isNaN(d) ? -Infinity : d; }
    return raw.toLowerCase();
  }
  function sortBy(table, idx, type, dir){
    var tb = table.tBodies[0]; if (!tb) return;
    var rows = Array.prototype.slice.call(tb.rows);
    rows.sort(function(a,b){
      var av = getVal(a.cells[idx], type);
      var bv = getVal(b.cells[idx], type);
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    for (var i=0;i<rows.length;i++) tb.appendChild(rows[i]);
  }
  function wire(table){
    var ths = table.tHead ? table.tHead.rows[0].cells : [];
    for (var i=0;i<ths.length;i++){
      (function(th, idx){
        th.addEventListener('click', function(){
          var type = th.getAttribute('data-sort-type') || 'string';
          var dir = th.classList.contains('asc') ? 'desc' : 'asc';
          for (var j=0;j<ths.length;j++){ ths[j].classList.remove('asc','desc'); }
          th.classList.add(dir);
          sortBy(table, idx, type, dir);
        });
      })(ths[i], i);
    }
  }
  var tables = document.querySelectorAll('table.sortable');
  for (var i=0;i<tables.length;i++) wire(tables[i]);
})();
`;

// Shared popover for per-entity actions (hide / merge into… / unhide
// / unmerge). Any table or list whose rows carry the data attributes
// `data-entity-key`, `data-entity-label`, and `data-entity-canonical`
// on a `<span class="entity-actions">` wrapper gets a ⋯ button that
// opens a small menu. All actions POST to /api/aliases/ and update
// the DOM in place on success.
const ENTITY_MENU_SCRIPT = `
(function(){
  var openMenu = null;
  function closeMenu(){ if (openMenu){ openMenu.remove(); openMenu = null; } }
  document.addEventListener('click', function(e){
    if (openMenu && !openMenu.contains(e.target) && !e.target.classList.contains('entity-menu-toggle')) {
      closeMenu();
    }
  });
  async function post(path, params){
    var r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return r.json().catch(function(){ return { ok: false }; });
  }
  function markActioned(el, text){
    var wrap = el.closest('.entity-actions') || el;
    wrap.style.opacity = '0.4';
    var tag = document.createElement('span');
    tag.className = 'sub';
    tag.style.marginLeft = '6px';
    tag.textContent = text;
    wrap.appendChild(tag);
  }
  window.openEntityMenu = function(btn){
    closeMenu();
    var wrap = btn.closest('.entity-actions');
    var key = wrap.getAttribute('data-entity-key');
    var label = wrap.getAttribute('data-entity-label');
    var canonical = wrap.getAttribute('data-entity-canonical');
    var status = wrap.getAttribute('data-entity-status') || 'active';
    var menu = document.createElement('div');
    menu.className = 'entity-menu';
    menu.style.cssText = 'position:absolute;z-index:1000;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:6px;min-width:260px;box-shadow:0 2px 8px rgba(0,0,0,.08);font-size:13px';
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 2) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    var header = document.createElement('div');
    header.style.cssText = 'padding:4px 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = '<strong>' + escapeText(canonical) + '</strong><br><span class="sub">' + escapeText(label) + ' · <code>' + escapeText(key) + '</code></span>';
    menu.appendChild(header);
    if (status === 'deleted') {
      menu.appendChild(actionButton('undelete', function(){
        post('/api/aliases/undelete', { key: key }).then(function(){ closeMenu(); markActioned(wrap, 'undeleted'); });
      }));
    } else if (status === 'merged') {
      menu.appendChild(actionButton('unmerge', function(){
        post('/api/aliases/unmerge', { key: key }).then(function(){ closeMenu(); markActioned(wrap, 'unmerged'); });
      }));
      menu.appendChild(actionButton('delete', function(){
        post('/api/aliases/delete', { key: key }).then(function(){ closeMenu(); markActioned(wrap, 'deleted'); });
      }));
    } else {
      var videoId = wrap.getAttribute('data-video-id') || '';
      menu.appendChild(actionButton('delete', function(){
        post('/api/aliases/delete', { key: key }).then(function(){ closeMenu(); markActioned(wrap, 'deleted'); });
      }));
      // Rename display — free-form text, no merge.
      menu.appendChild(actionButton('rename display…', function(){
        var v = prompt('Display text for ' + canonical + ' (this key stays the same):', canonical);
        if (!v || v === canonical) return;
        post('/api/aliases/display', { key: key, value: v }).then(function(){
          closeMenu(); markActioned(wrap, 'renamed → "' + v + '"');
        });
      }));
      // Merge-into search input with "+ create new" fallback. If a
      // videoId is present, add a scope toggle (corpus vs this video).
      var box = document.createElement('div');
      box.style.cssText = 'padding:4px 6px;margin-top:4px;border-top:1px solid var(--border)';
      var lbl = document.createElement('div');
      lbl.className = 'sub';
      lbl.textContent = videoId ? 'merge into… (scope below)' : 'merge into…';
      box.appendChild(lbl);
      var scope = 'corpus';
      if (videoId) {
        var toggleWrap = document.createElement('div');
        toggleWrap.style.cssText = 'font-size:11px;margin:2px 0';
        toggleWrap.innerHTML =
          '<label><input type="radio" name="scope_' + key + '" value="corpus" checked> corpus</label> ' +
          '<label><input type="radio" name="scope_' + key + '" value="video"> this video only</label>';
        toggleWrap.addEventListener('change', function(e){
          scope = e.target.value;
        });
        box.appendChild(toggleWrap);
      }
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'search same-label entities, or type a new name';
      input.style.cssText = 'width:100%;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:13px';
      box.appendChild(input);
      var results = document.createElement('div');
      results.style.cssText = 'max-height:180px;overflow:auto;margin-top:4px';
      box.appendChild(results);
      menu.appendChild(box);
      function doMerge(toKey, displayText) {
        if (scope === 'video' && videoId) {
          post('/api/aliases/video-merge', { videoId: videoId, from: key, to: toKey }).then(function(){
            closeMenu(); markActioned(wrap, 'video merge → ' + displayText);
          });
        } else {
          post('/api/aliases/merge', { from: key, to: toKey }).then(function(){
            closeMenu(); markActioned(wrap, 'merged → ' + displayText);
          });
        }
      }
      function doCreatePhantom(name) {
        // Only corpus scope: per-video merges require an existing target.
        if (scope === 'video') {
          alert('Per-video rename needs an existing target entity. Create it at corpus level first.');
          return;
        }
        post('/api/aliases/create-phantom', { label: label, name: name, mergeFrom: key }).then(function(r){
          closeMenu(); markActioned(wrap, 'merged → "' + name + '" (new)');
        });
      }
      var debounce;
      input.addEventListener('input', function(){
        clearTimeout(debounce);
        debounce = setTimeout(function(){
          var q = input.value.trim();
          results.innerHTML = '<div class="sub" style="padding:4px">searching…</div>';
          fetch('/api/aliases/search?q=' + encodeURIComponent(q) + '&label=' + encodeURIComponent(label))
            .then(function(r){ return r.json(); })
            .then(function(data){
              results.innerHTML = '';
              var items = (data.results || []).filter(function(r){ return r.key !== key; });
              var hasExact = items.some(function(r){
                return r.canonical.toLowerCase() === q.toLowerCase();
              });
              items.forEach(function(r){
                var row = document.createElement('div');
                row.style.cssText = 'padding:4px 6px;cursor:pointer;border-radius:3px';
                row.innerHTML = '<strong>' + escapeText(r.canonical) + '</strong> <span class="sub">(' + r.mentions + ' mentions, ' + r.videos + ' videos)</span>';
                row.addEventListener('mouseenter', function(){ row.style.background = '#f5f5f5'; });
                row.addEventListener('mouseleave', function(){ row.style.background = ''; });
                row.addEventListener('click', function(){ doMerge(r.key, r.canonical); });
                results.appendChild(row);
              });
              if (q && !hasExact) {
                var create = document.createElement('div');
                create.style.cssText = 'padding:4px 6px;cursor:pointer;border-radius:3px;border-top:1px dashed var(--border);margin-top:4px;color:var(--accent)';
                create.innerHTML = '+ create new: <strong>"' + escapeText(q) + '"</strong>';
                create.addEventListener('mouseenter', function(){ create.style.background = '#f5f5f5'; });
                create.addEventListener('mouseleave', function(){ create.style.background = ''; });
                create.addEventListener('click', function(){ doCreatePhantom(q); });
                results.appendChild(create);
              }
              if (items.length === 0 && !q) {
                results.innerHTML = '<div class="sub" style="padding:4px">type to search</div>';
              }
            });
        }, 150);
      });
      setTimeout(function(){ input.focus(); }, 0);
    }
    document.body.appendChild(menu);
    openMenu = menu;
  };
  function actionButton(text, onClick){
    var b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:4px 6px;border:none;background:none;cursor:pointer;border-radius:3px;font-size:13px';
    b.addEventListener('mouseenter', function(){ b.style.background = '#f5f5f5'; });
    b.addEventListener('mouseleave', function(){ b.style.background = ''; });
    b.addEventListener('click', onClick);
    return b;
  }
  function escapeText(s){
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Relation-specific menu. Attached to a <span class="relation-actions">
  // wrapper with data-video-id, data-subject-key, data-predicate,
  // data-object-key, data-time-start, and the display texts for subject
  // and object.
  window.openRelationMenu = function(btn){
    closeMenu();
    var wrap = btn.closest('.relation-actions');
    var videoId = wrap.getAttribute('data-video-id');
    var subjectKey = wrap.getAttribute('data-subject-key');
    var objectKey = wrap.getAttribute('data-object-key');
    var predicate = wrap.getAttribute('data-predicate');
    var timeStart = wrap.getAttribute('data-time-start');
    var subjectText = wrap.getAttribute('data-subject-text');
    var objectText = wrap.getAttribute('data-object-text');
    var compositeKey = subjectKey + '|' + predicate + '|' + objectKey + '|' + Math.floor(parseFloat(timeStart || '0'));
    var menu = document.createElement('div');
    menu.className = 'entity-menu';
    menu.style.cssText = 'position:absolute;z-index:1000;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:6px;min-width:280px;box-shadow:0 2px 8px rgba(0,0,0,.08);font-size:13px';
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 2) + 'px';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    var header = document.createElement('div');
    header.style.cssText = 'padding:4px 6px;border-bottom:1px solid var(--border);margin-bottom:4px';
    header.innerHTML = '<strong>' + escapeText(subjectText) + '</strong> <span class="sub">' + escapeText(predicate) + '</span> <strong>' + escapeText(objectText) + '</strong>';
    menu.appendChild(header);
    menu.appendChild(actionButton('delete this relationship (this video only)', function(){
      post('/api/aliases/delete-relation', { videoId: videoId, key: compositeKey }).then(function(){
        closeMenu();
        markActioned(wrap, 'deleted');
        var row = wrap.closest('tr');
        if (row) row.style.opacity = '0.4';
      });
    }));
    document.body.appendChild(menu);
    openMenu = menu;
  };
})();
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLE}</style></head>
  <body><header><a href="/WFD/">← catalog</a><a href="/WFD/admin">admin</a><a href="/admin/aliases">aliases</a><a href="/WFD/relationships">graph</a><a href="/WFD/facets">facets</a></header>${body}<script>${SORTABLE_SCRIPT}</script><script>${ENTITY_MENU_SCRIPT}</script>${CREDIT_FOOTER}</body></html>`;
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
    // --- Incremental graph API (search → expand → connect) ----------------
    if (url.startsWith("/api/graph/search")) {
      const u = new URL(url, "http://local");
      const q = u.searchParams.get("q") || "";
      const limit = Math.min(50, Number(u.searchParams.get("limit") || 10));
      sendJson(res, 200, graphSearch(opts.catalog, q, limit, opts.dataDir));
      return;
    }
    if (url.startsWith("/api/graph/neighbors")) {
      const u = new URL(url, "http://local");
      const id = u.searchParams.get("id") || "";
      const offset = Math.max(0, Number(u.searchParams.get("offset") || 0));
      const limit = Math.min(100, Number(u.searchParams.get("limit") || 20));
      const result = graphNeighbors(opts.catalog, id, offset, limit, opts.dataDir);
      if (!result) { sendJson(res, 404, { error: "node not found" }); return; }
      sendJson(res, 200, result);
      return;
    }
    if (url.startsWith("/api/graph/connections")) {
      const u = new URL(url, "http://local");
      const idsParam = u.searchParams.get("ids") || "";
      const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) { sendJson(res, 400, { error: "ids required" }); return; }
      sendJson(res, 200, graphConnections(opts.catalog, ids, opts.dataDir));
      return;
    }
    if (url === "/api/nlp/entity-index" || url.startsWith("/api/nlp/entity-index?")) {
      sendJson(res, 200, getEntityIndex(opts.catalog, opts.dataDir));
      return;
    }
    if (url === "/api/nlp/entity-videos" || url.startsWith("/api/nlp/entity-videos?")) {
      sendJson(res, 200, getEntityVideos(opts.catalog, opts.dataDir));
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
    // Dedicated NLP sub-route, matched before the generic /api/video/:id
    // so the greedy id regex does not swallow it. Returns the shape the
    // client-side NlpPanel expects: { entities, relationships }.
    const apiVideoNlp = url.match(/^\/api\/video\/([A-Za-z0-9_-]+)\/nlp(?:\?|$)/);
    if (apiVideoNlp) {
      const row = opts.catalog.get(apiVideoNlp[1]);
      if (!row) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const nlp = computeNlp(row, opts.dataDir) ?? {
        entities: [],
        relationships: [],
      };
      sendJson(res, 200, nlp);
      return;
    }
    const apiVideo = url.match(/^\/api\/video\/([A-Za-z0-9_-]+)(?:\?|$)/);
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

    // Aliases admin page — shows pending merge proposals and accepted
    // aliases. Operators accept/reject individual proposals via POST.
    if (url === "/admin/aliases" || url.startsWith("/admin/aliases?")) {
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      const aliasQ = new URL(url, "http://local").searchParams;
      const appliedMsg = aliasQ.get("applied");
      const appliedOk = aliasQ.get("ok") !== "0";
      const corpus = buildCorpusEntities(dataRoot);
      const aliases = readAliases(dataRoot);
      const clusters = buildMergeClusters(corpus, aliases);
      const classified = classifyClusters(clusters, aliases);
      const pendingClusters = classified.filter((c) => c.status === "pending");
      const resolvedClusters = classified.filter((c) => c.status === "resolved");
      const mergeCount = Object.keys(aliases).filter(
        (k) => !isSentinel(aliases[k]) && !k.includes("~~") && !k.includes("||"),
      ).length;
      const notSameCount = Object.keys(aliases).filter(
        (k) => aliases[k] === "__not_same__",
      ).length;

      function renderClusterCard(c: typeof classified[0], grayed: boolean): string {
        const nonCanonical = c.members.filter((m) => m !== c.canonicalKey);
        const checkboxes = nonCanonical
          .map((m) => {
            const form = c.memberForms[c.members.indexOf(m)];
            const isAccepted = aliases[m] !== undefined && !isSentinel(aliases[m]);
            const isNotSame = aliases[notSameKey(m, c.canonicalKey)] === "__not_same__";
            const marker = isAccepted ? " = same" : isNotSame ? " = different" : "";
            const checked = grayed ? isAccepted : true;
            return `<label style="display:block;padding:2px 0${grayed ? ";opacity:0.5" : ""}">
              <input type="checkbox" name="member" value="${escapeHtml(m)}" ${checked ? "checked" : ""} ${grayed ? "disabled" : ""} />
              ${escapeHtml(form)}${marker ? `<span class="sub">${marker}</span>` : ""}
            </label>`;
          })
          .join("");
        const buttons = grayed
          ? `<button onclick="undoCluster(this)" data-canonical="${escapeHtml(c.canonicalKey)}" data-members='${escapeHtml(JSON.stringify(nonCanonical))}' style="color:var(--muted)">undo</button>`
          : `<button onclick="selectAll(this)">all</button>
             <button onclick="deselectAll(this)">none</button>
             <button onclick="saveCluster(this)" data-canonical="${escapeHtml(c.canonicalKey)}">save</button>`;
        return `<div class="alias-card" style="border:1px solid var(--border);border-radius:4px;padding:12px;margin-bottom:8px${grayed ? ";opacity:0.6" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <strong>[${escapeHtml(c.label)}]</strong>
              merge into <strong>${escapeHtml(c.canonicalForm)}</strong>
              <span class="sub">(${c.totalCooccurrences} co-occur, ${c.members.length} members)</span>
            </div>
            <div style="display:flex;gap:4px">${buttons}</div>
          </div>
          <div style="margin-top:8px;padding-left:12px">${checkboxes}</div>
        </div>`;
      }

      const aliasScript = `
        function post(action, body) {
          return fetch('/admin/aliases/' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body,
          });
        }
        function deselectAll(btn) {
          var card = btn.closest('.alias-card');
          var boxes = card.querySelectorAll('input[name=member]:not(:disabled)');
          for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
        }
        function selectAll(btn) {
          var card = btn.closest('.alias-card');
          var boxes = card.querySelectorAll('input[name=member]:not(:disabled)');
          for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
        }
        function saveCluster(btn) {
          var card = btn.closest('.alias-card');
          var canonical = btn.getAttribute('data-canonical');
          var allBoxes = card.querySelectorAll('input[name=member]');
          var checked = [], all = [];
          for (var i = 0; i < allBoxes.length; i++) {
            all.push(allBoxes[i].value);
            if (allBoxes[i].checked) checked.push(allBoxes[i].value);
          }
          var params = 'canonical=' + encodeURIComponent(canonical)
            + '&checked=' + encodeURIComponent(JSON.stringify(checked))
            + '&all=' + encodeURIComponent(JSON.stringify(all));
          post('save', params).then(function() {
            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';
          });
        }
        function undoCluster(btn) {
          var canonical = btn.getAttribute('data-canonical');
          var members = JSON.parse(btn.getAttribute('data-members'));
          var params = 'canonical=' + encodeURIComponent(canonical)
            + '&members=' + encodeURIComponent(JSON.stringify(members));
          post('undo', params).then(function() {
            var card = btn.closest('.alias-card');
            card.style.display = 'none';
          });
        }
      `;

      // Flat editable list of current merges and deleted entities.
      // Paired with a search box that filters both this table and the
      // pending-cluster cards below.
      const mergeEntries = Object.entries(aliases)
        .filter(([k, v]) => !isSentinel(v) && !k.includes("~~") && !k.includes("||"))
        .sort(([a], [b]) => a.localeCompare(b));
      const deletedEntries = Object.entries(aliases)
        .filter(([k, v]) =>
          (v === SENTINEL_DELETED || v === "__hidden__") &&
          !k.includes("~~") && !k.includes("||"),
        )
        .sort(([a], [b]) => a.localeCompare(b));

      const mergeRows = mergeEntries
        .map(([from, to]) => {
          const fromEnt = corpus.get(from);
          const toEnt = corpus.get(to);
          const label = fromEnt?.label ?? from.split(":")[0];
          const fromCanonical = fromEnt?.canonical ?? from.split(":").slice(1).join(":");
          const toCanonical = toEnt?.canonical ?? to.split(":").slice(1).join(":");
          const mentions = fromEnt?.totalMentions ?? 0;
          return `<tr data-search="${escapeHtml((fromCanonical + " " + toCanonical + " " + label).toLowerCase())}">
            <td>${escapeHtml(label)}</td>
            <td><a href="/admin/entity/${escapeHtml(encodeURIComponent(from))}">${escapeHtml(fromCanonical)}</a></td>
            <td>→</td>
            <td class="merge-target" data-from="${escapeHtml(from)}" data-label="${escapeHtml(label)}"><a href="/admin/entity/${escapeHtml(encodeURIComponent(to))}">${escapeHtml(toCanonical)}</a> <button class="edit-target" onclick="editTarget(this)" style="border:none;background:none;cursor:pointer;font-size:12px;color:var(--muted)">edit</button></td>
            <td data-sort-value="${mentions}">${mentions}</td>
            <td><button onclick="unmerge('${escapeHtml(from)}', this)" style="color:var(--muted)">undo</button></td>
          </tr>`;
        })
        .join("");

      const deletedEntityRows = deletedEntries
        .map(([key]) => {
          const ent = corpus.get(key);
          const label = ent?.label ?? key.split(":")[0];
          const canonical = ent?.canonical ?? key.split(":").slice(1).join(":");
          const mentions = ent?.totalMentions ?? 0;
          return `<tr data-search="${escapeHtml((canonical + " " + label).toLowerCase())}">
            <td>${escapeHtml(label)}</td>
            <td><a href="/admin/entity/${escapeHtml(encodeURIComponent(key))}">${escapeHtml(canonical)}</a></td>
            <td data-sort-value="${mentions}">${mentions}</td>
            <td><button onclick="undelete('${escapeHtml(key)}', this)" style="color:var(--muted)">undelete</button></td>
          </tr>`;
        })
        .join("");

      const pendingCardsWithSearch = pendingClusters
        .map((c) => {
          const searchable = [c.canonicalForm, ...c.memberForms, c.label]
            .join(" ")
            .toLowerCase();
          return `<div data-search="${escapeHtml(searchable)}">${renderClusterCard(c, false)}</div>`;
        })
        .join("");
      const resolvedCardsWithSearch = resolvedClusters
        .map((c) => {
          const searchable = [c.canonicalForm, ...c.memberForms, c.label]
            .join(" ")
            .toLowerCase();
          return `<div data-search="${escapeHtml(searchable)}">${renderClusterCard(c, true)}</div>`;
        })
        .join("");

      const flatListScript = `
        function filterAll() {
          var q = document.getElementById('alias-search').value.toLowerCase().trim();
          var items = document.querySelectorAll('[data-search]');
          for (var i = 0; i < items.length; i++) {
            var hay = items[i].getAttribute('data-search');
            items[i].style.display = (!q || hay.indexOf(q) >= 0) ? '' : 'none';
          }
        }
        async function rebuildIndexes() {
          var btn = document.getElementById('rebuild-btn');
          var status = document.getElementById('rebuild-status');
          btn.disabled = true;
          status.textContent = 'rebuilding…';
          try {
            var r = await fetch('/api/indexes/rebuild', { method: 'POST' });
            var data = await r.json();
            if (data.ok) {
              status.textContent = 'done: ' + (data.outcome && data.outcome.notes || 'ok');
            } else {
              status.textContent = 'error: ' + (data.error || 'unknown');
            }
          } catch (e) {
            status.textContent = 'error: ' + e.message;
          } finally {
            btn.disabled = false;
          }
        }
        async function unmerge(key, btn) {
          var r = await fetch('/api/aliases/unmerge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'key=' + encodeURIComponent(key),
          });
          if (r.ok) btn.closest('tr').style.opacity = '0.4';
        }
        async function undelete(key, btn) {
          var r = await fetch('/api/aliases/undelete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'key=' + encodeURIComponent(key),
          });
          if (r.ok) btn.closest('tr').style.opacity = '0.4';
        }
        function editTarget(btn) {
          var cell = btn.closest('.merge-target');
          var from = cell.getAttribute('data-from');
          var label = cell.getAttribute('data-label');
          var input = document.createElement('input');
          input.type = 'text';
          input.placeholder = 'search new target…';
          input.style.cssText = 'width:200px;padding:2px 4px;font-size:13px';
          var results = document.createElement('div');
          results.style.cssText = 'position:absolute;background:var(--bg);border:1px solid var(--border);border-radius:3px;max-height:160px;overflow:auto;z-index:100;min-width:220px';
          cell.innerHTML = '';
          cell.appendChild(input);
          cell.appendChild(results);
          input.focus();
          var debounce;
          input.addEventListener('input', function() {
            clearTimeout(debounce);
            debounce = setTimeout(async function() {
              var q = input.value.trim();
              var r = await fetch('/api/aliases/search?q=' + encodeURIComponent(q) + '&label=' + encodeURIComponent(label));
              var data = await r.json();
              results.innerHTML = '';
              (data.results || []).filter(function(x) { return x.key !== from; }).forEach(function(x) {
                var row = document.createElement('div');
                row.style.cssText = 'padding:3px 6px;cursor:pointer';
                row.textContent = x.canonical + ' (' + x.mentions + ')';
                row.addEventListener('mouseenter', function() { row.style.background = '#f5f5f5'; });
                row.addEventListener('mouseleave', function() { row.style.background = ''; });
                row.addEventListener('click', async function() {
                  await fetch('/api/aliases/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(x.key),
                  });
                  cell.innerHTML = '<a href="/admin/entity/' + encodeURIComponent(x.key) + '">' + x.canonical + '</a> <span class="sub">(updated, reload to re-edit)</span>';
                });
                results.appendChild(row);
              });
            }, 150);
          });
        }
      `;

      const toast = appliedMsg
        ? `<div style="background:${appliedOk ? "#e8f5e9" : "#ffebee"};color:${appliedOk ? "var(--good)" : "var(--bad)"};border:1px solid ${appliedOk ? "#c8e6c9" : "#ffcdd2"};padding:8px 12px;border-radius:4px;margin-bottom:1em">
            ${appliedOk ? "✓" : "✗"} ${escapeHtml(appliedMsg)}
          </div>`
        : "";

      const body = `
        <h1>Entity aliases</h1>
        ${toast}
        <p>${corpus.size} corpus entities · ${mergeCount} merges · ${deletedEntries.length} deleted · ${notSameCount} not-same pairs · ${pendingClusters.length} pending clusters</p>

        <p style="display:flex;gap:8px;align-items:center;margin:1em 0">
          <input id="alias-search" type="text" placeholder="search all tables and clusters by canonical, label, or key..." oninput="filterAll()" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:14px"/>
          <button id="rebuild-btn" onclick="rebuildIndexes()" style="padding:6px 14px;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:white;border-radius:3px">rebuild graph</button>
          <span id="rebuild-status" class="sub"></span>
        </p>

        <h2>Current merges <span class="sub">${mergeCount}</span></h2>
        <table class="sortable">
          <thead><tr>
            <th>label</th><th>from</th><th></th><th>to (click edit to change)</th>
            <th data-sort-type="number">mentions</th><th>action</th>
          </tr></thead>
          <tbody>${mergeRows || '<tr><td colspan="6">no merges yet</td></tr>'}</tbody>
        </table>

        <h2>Deleted entities <span class="sub">${deletedEntries.length}</span></h2>
        <table class="sortable">
          <thead><tr>
            <th>label</th><th>canonical</th>
            <th data-sort-type="number">mentions</th><th>action</th>
          </tr></thead>
          <tbody>${deletedEntityRows || '<tr><td colspan="4">none</td></tr>'}</tbody>
        </table>

        <h2>Pending clusters <span class="sub">${pendingClusters.length}</span></h2>
        <p>Check = same entity, uncheck = different entity. Click <strong>save</strong> to record your decision. After a round of saves, run <code>captions pipeline --stage indexes</code> to rebuild the graph.</p>
        ${pendingCardsWithSearch || '<p>None — all clusters resolved.</p>'}

        <h2>Resolved clusters <span class="sub">${resolvedClusters.length}</span></h2>
        ${resolvedCardsWithSearch || '<p>None yet.</p>'}
        <script>${aliasScript}</script>
        <script>${flatListScript}</script>
      `;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(layout("aliases — captions", body));
      return;
    }
    // Rebuild the corpus-wide aggregated indexes (entity-index.json,
    // entity-videos.json, relationships-graph.json) in-process. Same
    // work as `captions pipeline --stage indexes` but without the
    // subprocess, so the admin UI's "apply changes" button gets an
    // immediate result.
    if (url === "/api/indexes/rebuild" && req.method === "POST") {
      (async () => {
        try {
          // Lazy-import to avoid a cycle at module load time.
          const { indexesStage } = await import("../pipeline/stages.js");
          const { GraphStore } = await import("../graph/store.js");
          const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
          let storeInst: InstanceType<typeof GraphStore> | null = null;
          const ctx = {
            catalog: opts.catalog,
            dataDir: dataRoot,
            getStore: () => {
              if (!storeInst) storeInst = new GraphStore(join(dataRoot, "graph", "graph.json"));
              return storeInst;
            },
          };
          const outcome = await indexesStage.run(ctx);
          nlpCache.clear();
          entityIndexCache = null;
          entityVideosCache = null;
          relationshipsGraphCache = null;
          sendJson(res, 200, { ok: true, outcome });
        } catch (err) {
          sendJson(res, 500, { error: (err as Error).message });
        }
      })();
      return;
    }
    // Autocomplete feed for the entity popover "merge into…" input.
    // Returns up to 20 entities whose canonical contains the query,
    // optionally filtered to a specific label. Sorted by mention count
    // descending so the most prominent candidates land first.
    if (url.startsWith("/api/aliases/search")) {
      const u = new URL(url, "http://local");
      const q = (u.searchParams.get("q") ?? "").toLowerCase().trim();
      const label = u.searchParams.get("label") ?? "";
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      const aliases = readAliases(dataRoot);
      const corpus = buildCorpusEntities(dataRoot);
      const matches: Array<{
        key: string;
        label: string;
        canonical: string;
        mentions: number;
        videos: number;
      }> = [];
      for (const e of corpus.values()) {
        if (label && e.label !== label) continue;
        if (q && !e.canonical.toLowerCase().includes(q)) continue;
        if (isSentinel(aliases[e.key] ?? "")) continue;
        matches.push({
          key: e.key,
          label: e.label,
          canonical: e.canonical,
          mentions: e.totalMentions,
          videos: e.videoIds.size,
        });
      }
      matches.sort((a, b) => b.mentions - a.mentions);
      sendJson(res, 200, { results: matches.slice(0, 20) });
      return;
    }
    // Per-entity alias actions: fast, single-key edits from the entity
    // popover menu on /admin/video/:id, /admin/entity/:key, and (once
    // VITE_ADMIN is wired up) the relationships graph page.
    if (url.startsWith("/api/aliases/") && req.method === "POST") {
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      let postBody = "";
      req.on("data", (chunk: Buffer) => { postBody += chunk.toString(); });
      req.on("end", () => {
        const params = new URLSearchParams(postBody);
        const aliases = readAliases(dataRoot);
        const action = url.slice("/api/aliases/".length);
        if (action === "delete" || action === "hide") {
          // `hide` is kept as an alias for pre-rename clients.
          const key = params.get("key") ?? "";
          if (!key) return sendJson(res, 400, { error: "missing key" });
          if (aliases[key] && !isSentinel(aliases[key])) delete aliases[key];
          aliases[key] = SENTINEL_DELETED;
        } else if (action === "undelete" || action === "unhide") {
          const key = params.get("key") ?? "";
          if (!key) return sendJson(res, 400, { error: "missing key" });
          if (aliases[key] === SENTINEL_DELETED || aliases[key] === "__hidden__") {
            delete aliases[key];
          }
        } else if (action === "merge") {
          const from = params.get("from") ?? "";
          const to = params.get("to") ?? "";
          if (!from || !to) return sendJson(res, 400, { error: "missing from/to" });
          if (from === to) return sendJson(res, 400, { error: "from === to" });
          aliases[from] = to;
        } else if (action === "unmerge") {
          const key = params.get("key") ?? "";
          if (!key) return sendJson(res, 400, { error: "missing key" });
          if (aliases[key] !== undefined && !isSentinel(aliases[key])) {
            delete aliases[key];
          }
        } else if (action === "display") {
          // Override how an entity renders in the UI without changing
          // its key. Write to display:<key>.
          const key = params.get("key") ?? "";
          const value = params.get("value") ?? "";
          if (!key || !value) return sendJson(res, 400, { error: "missing key/value" });
          aliases[`display:${key}`] = value;
        } else if (action === "undisplay") {
          const key = params.get("key") ?? "";
          if (!key) return sendJson(res, 400, { error: "missing key" });
          delete aliases[`display:${key}`];
        } else if (action === "video-merge") {
          // Per-video merge: this key in this video only should render
          // as another entity. Target must be an existing corpus key.
          const videoId = params.get("videoId") ?? "";
          const from = params.get("from") ?? "";
          const to = params.get("to") ?? "";
          if (!videoId || !from || !to)
            return sendJson(res, 400, { error: "missing videoId/from/to" });
          aliases[`video:${videoId}:${from}`] = to;
        } else if (action === "video-unmerge") {
          const videoId = params.get("videoId") ?? "";
          const from = params.get("from") ?? "";
          if (!videoId || !from)
            return sendJson(res, 400, { error: "missing videoId/from" });
          delete aliases[`video:${videoId}:${from}`];
        } else if (action === "delete-relation") {
          // Suppress one relationship in one video. `key` is the
          // composite: subjectKey|predicate|objectKey|timeStart.
          const videoId = params.get("videoId") ?? "";
          const key = params.get("key") ?? "";
          if (!videoId || !key)
            return sendJson(res, 400, { error: "missing videoId/key" });
          aliases[`del:${videoId}:${key}`] = "true";
        } else if (action === "undelete-relation") {
          const videoId = params.get("videoId") ?? "";
          const key = params.get("key") ?? "";
          if (!videoId || !key)
            return sendJson(res, 400, { error: "missing videoId/key" });
          delete aliases[`del:${videoId}:${key}`];
        } else if (
          action === "claim-truth-override" ||
          action === "claim-untruth-override" ||
          action === "delete-claim" ||
          action === "undelete-claim"
        ) {
          // Claim-level sections (claimTruthOverrides / claimDeletions) live
          // only in the v2 structured file, not in the flat runtime map.
          // Use the typed mutators directly; do NOT write the flat map
          // afterwards or we'd clobber the structured sections.
          const claimId = params.get("claimId") ?? "";
          if (!claimId) return sendJson(res, 400, { error: "missing claimId" });
          try {
            if (action === "claim-truth-override") {
              const dt = Number(params.get("directTruth"));
              if (!Number.isFinite(dt) || dt < 0 || dt > 1) {
                return sendJson(res, 400, { error: "directTruth not in [0,1]" });
              }
              const rationale = params.get("rationale") ?? undefined;
              addClaimTruthOverride(dataRoot, claimId, dt, rationale);
            } else if (action === "claim-untruth-override") {
              removeClaimTruthOverride(dataRoot, claimId);
            } else if (action === "delete-claim") {
              addClaimDeletion(dataRoot, claimId);
            } else {
              removeClaimDeletion(dataRoot, claimId);
            }
          } catch (err) {
            return sendJson(res, 400, { error: (err as Error).message });
          }
          nlpCache.clear();
          entityIndexCache = null;
          entityVideosCache = null;
          relationshipsGraphCache = null;
          opts.catalog.markGraphDirty();
          return sendJson(res, 200, { ok: true });
        } else if (action === "create-phantom") {
          // Create a phantom entity: a key with a display override,
          // targeted by one or more merges. `name` is the display
          // text; `label` is the entity label; `mergeFrom` (optional)
          // is an existing key to merge into the phantom.
          const label = params.get("label") ?? "";
          const name = params.get("name") ?? "";
          const mergeFrom = params.get("mergeFrom") ?? "";
          if (!label || !name) return sendJson(res, 400, { error: "missing label/name" });
          const phantomKey = `${label}:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
          aliases[`display:${phantomKey}`] = name;
          if (mergeFrom && mergeFrom !== phantomKey) {
            aliases[mergeFrom] = phantomKey;
          }
          // Return the phantom key so the caller can use it.
          writeAliases(dataRoot, aliases);
          nlpCache.clear();
          entityIndexCache = null;
          entityVideosCache = null;
          relationshipsGraphCache = null;
          opts.catalog.markGraphDirty();
          return sendJson(res, 200, { ok: true, phantomKey });
        } else {
          return sendJson(res, 400, { error: "unknown action" });
        }
        writeAliases(dataRoot, aliases);
        // Bust the caches so the UI sees the update on next read.
        nlpCache.clear();
        entityIndexCache = null;
        entityVideosCache = null;
        relationshipsGraphCache = null;
        // Bump the graph watermark so `pipeline --stage indexes` actually
        // re-runs. Alias edits don't touch per-video outputs, so without
        // this the indexes stage stays "up to date" and the rebuilt graph
        // never picks up the merges.
        opts.catalog.markGraphDirty();
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    // Save/undo alias decisions (POST).
    if (url.startsWith("/admin/aliases/") && req.method === "POST") {
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      let postBody = "";
      req.on("data", (chunk: Buffer) => { postBody += chunk.toString(); });
      req.on("end", () => {
        const params = new URLSearchParams(postBody);
        const aliases = readAliases(dataRoot);
        if (url.endsWith("/save")) {
          // Checked = same, unchecked = not same.
          const canonical = params.get("canonical") ?? "";
          let checked: string[] = [];
          let all: string[] = [];
          try {
            checked = JSON.parse(params.get("checked") ?? "[]") as string[];
            all = JSON.parse(params.get("all") ?? "[]") as string[];
          } catch { /* ignore */ }
          recordReview(aliases, canonical, checked, all);
        } else if (url.endsWith("/undo")) {
          // Remove all merge and not-same entries for members of this cluster.
          const canonical = params.get("canonical") ?? "";
          let members: string[] = [];
          try {
            members = JSON.parse(params.get("members") ?? "[]") as string[];
          } catch { /* ignore */ }
          for (const m of members) {
            delete aliases[m];
            delete aliases[notSameKey(m, canonical)];
          }
        } else {
          res.writeHead(400);
          res.end("unknown action");
          return;
        }
        writeAliases(dataRoot, aliases);
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    // Read-only NLP inspection page. Pure HTML, no SPA bundle, no editing —
    // hand-editing NER output is not supported, and downstream refinements
    // live in the ai stage's bundles/responses on disk.
    // Per-entity admin page. Shows everything we know about one entity
    // key: current alias/hidden state, mention count, video list, and
    // the same ⋯ popover for hide/merge actions.
    // GET /admin/apply?op=...&... — one-click apply entry point for
    // links embedded in GitHub issue bodies. Silent apply, then
    // redirect to /admin/aliases with an ?applied=<summary> query the
    // aliases page reads into a toast banner.
    if (url.startsWith("/admin/apply")) {
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      const u = new URL(url, "http://local");
      const op = u.searchParams.get("op") ?? "";
      const aliases = readAliases(dataRoot);
      let summary = "";
      let ok = true;
      if (op === "delete" || op === "hide") {
        const key = u.searchParams.get("key") ?? "";
        if (!key) { ok = false; summary = "missing key"; }
        else {
          if (aliases[key] && !isSentinel(aliases[key])) delete aliases[key];
          aliases[key] = SENTINEL_DELETED;
          summary = `deleted ${key}`;
        }
      } else if (op === "merge") {
        const from = u.searchParams.get("from") ?? "";
        const to = u.searchParams.get("to") ?? "";
        if (!from || !to || from === to) { ok = false; summary = "bad from/to"; }
        else { aliases[from] = to; summary = `merged ${from} → ${to}`; }
      } else if (op === "display") {
        const key = u.searchParams.get("key") ?? "";
        const value = u.searchParams.get("value") ?? "";
        if (!key || !value) { ok = false; summary = "missing key/value"; }
        else { aliases[`display:${key}`] = value; summary = `display ${key} = "${value}"`; }
      } else if (op === "video-merge") {
        const videoId = u.searchParams.get("videoId") ?? "";
        const from = u.searchParams.get("from") ?? "";
        const to = u.searchParams.get("to") ?? "";
        if (!videoId || !from || !to) { ok = false; summary = "missing videoId/from/to"; }
        else { aliases[`video:${videoId}:${from}`] = to; summary = `video:${videoId} ${from} → ${to}`; }
      } else if (op === "delete-relation") {
        const videoId = u.searchParams.get("videoId") ?? "";
        const key = u.searchParams.get("key") ?? "";
        if (!videoId || !key) { ok = false; summary = "missing videoId/key"; }
        else { aliases[`del:${videoId}:${key}`] = "true"; summary = `deleted relation in ${videoId}`; }
      } else {
        ok = false;
        summary = `unknown op: ${op}`;
      }
      if (ok) {
        writeAliases(dataRoot, aliases);
        nlpCache.clear();
        entityIndexCache = null;
        entityVideosCache = null;
        relationshipsGraphCache = null;
        opts.catalog.markGraphDirty();
      }
      const target = `/admin/aliases?applied=${encodeURIComponent(summary)}&ok=${ok ? 1 : 0}`;
      res.writeHead(303, { location: target });
      res.end();
      return;
    }
    const adminEntity = url.match(/^\/admin\/entity\/(.+?)(?:\?|$)/);
    if (adminEntity) {
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      const key = decodeURIComponent(adminEntity[1]);
      const aliases = readAliases(dataRoot);
      const corpus = buildCorpusEntities(dataRoot);
      const entity = corpus.get(key);
      const resolved = resolveKey(key, aliases);
      const mergedInto = resolved !== key ? resolved : null;
      const hidden = isDeleted(key, aliases);

      let status: "active" | "merged" | "deleted" = "active";
      if (hidden) status = "deleted";
      else if (mergedInto) status = "merged";

      const statusBadge =
        status === "deleted"
          ? `<span class="pill bad">deleted</span>`
          : status === "merged"
          ? `<span class="pill warn">merged → ${escapeHtml(mergedInto ?? "")}</span>`
          : `<span class="pill ok">active</span>`;

      if (!entity) {
        const body = `<h1>${escapeHtml(key)}</h1>
          <p>${statusBadge}</p>
          <p>No mentions found in the corpus under this key. It may be an alias target that only appears via other entities merging into it, or the key may be stale.</p>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(layout(`entity — ${key}`, body));
        return;
      }

      // Collect per-video mentions from the entity index videos file.
      const videoIdx = readPersistedEntityVideos(dataRoot) ?? {};
      // The index is keyed on post-alias entity ids. Look up both the
      // raw key and any merge target so we surface the same evidence
      // the graph/ui actually display.
      const refs =
        videoIdx[resolved] ?? videoIdx[key] ?? [];
      const videoRows = refs
        .slice()
        .sort((a, b) => b.mentions.length - a.mentions.length)
        .slice(0, 50)
        .map((ref) => {
          const row = opts.catalog.get(ref.videoId);
          const title = row?.title ?? ref.videoId;
          const first = ref.mentions[0];
          const link = first
            ? `<a target="_blank" href="${escapeHtml(deepLink(ref.videoId, first.timeStart))}">${formatTime(first.timeStart)}</a>`
            : "—";
          return `<tr>
            <td><a href="/admin/video/${escapeHtml(ref.videoId)}">${escapeHtml(ref.videoId)}</a></td>
            <td>${escapeHtml(title)}</td>
            <td data-sort-value="${ref.mentions.length}">${ref.mentions.length}</td>
            <td>${link}</td>
          </tr>`;
        })
        .join("");

      const mergedFrom = Object.entries(aliases)
        .filter(([, v]) => v === key && !isSentinel(v))
        .map(([k]) => k);
      const mergedFromRows = mergedFrom
        .map((k) => {
          const e = corpus.get(k);
          return `<tr>
            <td><a href="/admin/entity/${escapeHtml(encodeURIComponent(k))}">${escapeHtml(k)}</a></td>
            <td>${escapeHtml(e?.canonical ?? k)}</td>
            <td>${e?.totalMentions ?? "—"}</td>
          </tr>`;
        })
        .join("");

      const actions = `<span class="entity-actions" data-entity-key="${escapeHtml(key)}" data-entity-label="${escapeHtml(entity.label)}" data-entity-canonical="${escapeHtml(entity.canonical)}" data-entity-status="${status}"><button class="entity-menu-toggle" onclick="openEntityMenu(this)" style="border:1px solid var(--border);background:var(--bg);cursor:pointer;padding:4px 10px;border-radius:3px">actions ⋯</button></span>`;

      const body = `
        <h1>${escapeHtml(entity.canonical)}</h1>
        <p>
          <code>${escapeHtml(key)}</code> · [${escapeHtml(entity.label)}] · ${statusBadge} · ${entity.totalMentions} mentions · ${entity.videoIds.size} videos
        </p>
        <p>${actions}</p>

        <h2>Appears in <span class="sub">${refs.length} videos</span></h2>
        <table class="sortable">
          <thead><tr><th>videoId</th><th>title</th><th data-sort-type="number">mentions</th><th>first</th></tr></thead>
          <tbody>${videoRows || '<tr><td colspan="4">none</td></tr>'}</tbody>
        </table>

        <h2>Merged-from <span class="sub">${mergedFrom.length}</span></h2>
        <table class="sortable">
          <thead><tr><th>key</th><th>canonical</th><th data-sort-type="number">mentions</th></tr></thead>
          <tbody>${mergedFromRows || '<tr><td colspan="3">no entities merge into this one</td></tr>'}</tbody>
        </table>
      `;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(layout(`entity — ${entity.canonical}`, body));
      return;
    }
    // Unified per-video admin page — neural entities + relations on one
    // screen with a troubleshooting section. Safe to call before any
    // neural stage has run; the render function shows a "run `captions
    // entities`" stub for each missing artifact.
    const adminVideo = url.match(/^\/admin\/video\/([A-Za-z0-9_-]+)/);
    if (adminVideo) {
      const row = opts.catalog.get(adminVideo[1]);
      if (!row) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end(layout("not found", `<p>no such video: ${escapeHtml(adminVideo[1])}</p>`));
        return;
      }
      const dataRoot = opts.dataDir ?? join(process.cwd(), "data");
      const neuralEntities = readPersistedEntities(row.videoId, dataRoot);
      const neuralRelations = readPersistedRelations(row.videoId, dataRoot);
      const aiResponseStale = readAiResponseStale(row.videoId, opts.dataDir);
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        renderUnifiedVideoAdmin(
          row,
          neuralEntities,
          neuralRelations,
          aiResponseStale,
        ),
      );
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
