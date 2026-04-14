// Query layer for the facets page.
//
// Thin abstraction over an in-memory dataset of (video, entity, mentionCount)
// rows plus a video-metadata lookup. This is the ONLY module that touches raw
// JSON endpoints or runs aggregate math — every React component asks questions
// via the functions exported here.
//
// Why not DuckDB-WASM for V1: the corpus is ~400 videos and a few thousand
// (video × entity) rows — pure JS Map/array ops run the worst-case facet
// query in sub-millisecond time with zero download cost. The module's shape
// is deliberately SQL-like so swapping in DuckDB-WASM later is a drop-in
// replacement: same inputs, same outputs.
//
// Data sources — go through /api/* so the same code path works in both the
// dev server (real routes) and the static GitHub Pages build (intercepted by
// scripts/static-shim.js, which resolves from data/ on disk). Backing files:
//   data/catalog/catalog.json         — video metadata
//   data/nlp/entity-index.json        — { id, type, canonical, mentionCount, videoCount }[]
//   data/nlp/entity-videos.json       — { [entityId]: [{ videoId, mentions: span[] }] }

import type { VideoRow } from "../shared/catalog-columns.js";

export interface EntityMeta {
  id: string;
  type: string;
  canonical: string;
}

export interface Fact {
  entityId: string;
  videoId: string;
  count: number;
}

export interface FacetBundle {
  videos: VideoRow[];
  videoById: Map<string, VideoRow>;
  entities: Map<string, EntityMeta>;
  facts: Fact[];
  factsByEntity: Map<string, Fact[]>;
  factsByVideo: Map<string, Fact[]>;
  typesInOrder: string[];
}

export interface SelectionEntry {
  type: string;
  groups: Set<string>[];
}

export type Selection = SelectionEntry[];

export interface FacetRow {
  entityId: string;
  canonical: string;
  type: string;
  total: number;
  pinned?: boolean;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.json();
}

let loadPromise: Promise<FacetBundle> | null = null;

// One-shot load. Cached so re-navigating to the page is free.
export function loadFacetData(): Promise<FacetBundle> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [catalogResult, entityIndex, entityVideos] = await Promise.all([
      fetchJson("/api/catalog?pageSize=100000&page=1"),
      fetchJson("/api/nlp/entity-index"),
      fetchJson("/api/nlp/entity-videos"),
    ]);

    const allVideos = (catalogResult.rows || []) as VideoRow[];
    const videos = allVideos.filter((r) => r.status === "fetched");
    const videoById = new Map<string, VideoRow>(videos.map((r) => [r.videoId, r]));

    const entities = new Map<string, EntityMeta>();
    for (const e of entityIndex as EntityMeta[]) {
      entities.set(e.id, { id: e.id, type: e.type, canonical: e.canonical });
    }

    const facts: Fact[] = [];
    const factsByEntity = new Map<string, Fact[]>();
    const factsByVideo = new Map<string, Fact[]>();
    const typeTotals = new Map<string, number>();

    const evEntries = Object.entries(entityVideos as Record<string, { videoId: string; mentions: any[] }[]>);
    for (const [entityId, refs] of evEntries) {
      const meta = entities.get(entityId);
      if (!meta) continue;
      for (const ref of refs) {
        if (!videoById.has(ref.videoId)) continue;
        const count = (ref.mentions || []).length;
        if (count === 0) continue;
        const fact: Fact = { entityId, videoId: ref.videoId, count };
        facts.push(fact);
        let arr = factsByEntity.get(entityId);
        if (!arr) { arr = []; factsByEntity.set(entityId, arr); }
        arr.push(fact);
        let varr = factsByVideo.get(ref.videoId);
        if (!varr) { varr = []; factsByVideo.set(ref.videoId, varr); }
        varr.push(fact);
        typeTotals.set(meta.type, (typeTotals.get(meta.type) || 0) + count);
      }
    }

    const typesInOrder = [...typeTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    return { videos, videoById, entities, facts, factsByEntity, factsByVideo, typesInOrder };
  })();
  return loadPromise;
}

// Compute the active video-id set for a given selection state.
//
// Semantics:
//   - OR within a group (multi-select inside one facet is OR)
//   - AND across groups of the same type (second facet narrows the first)
//   - AND across types (person AND org narrows both)
//
// Empty selection → all fetched videos. Empty group is ignored.
export function activeVideoIds(bundle: FacetBundle, selection: Selection): Set<string> {
  let active: Set<string> | null = null;
  for (const { groups } of selection) {
    for (const group of groups) {
      if (!group || group.size === 0) continue;
      const groupVideos = new Set<string>();
      for (const eid of group) {
        const f = bundle.factsByEntity.get(eid);
        if (!f) continue;
        for (const x of f) groupVideos.add(x.videoId);
      }
      if (active === null) {
        active = groupVideos;
      } else {
        const next = new Set<string>();
        for (const v of active) if (groupVideos.has(v)) next.add(v);
        active = next;
      }
    }
  }
  if (active === null) return new Set(bundle.videoById.keys());
  return active;
}

// Compute top-N bars for one entity type, scoped to the given active video
// set. Returns `top` (descending by total) and `pinned` (always-visible
// entities whose ids are in `includeIds` but fell out of the top-N).
export function topEntitiesForType(
  bundle: FacetBundle,
  type: string,
  activeVideos: Set<string>,
  limit = 25,
  includeIds: Set<string> | null = null,
): { top: FacetRow[]; pinned: FacetRow[] } {
  const totals = new Map<string, number>();
  for (const videoId of activeVideos) {
    const varr = bundle.factsByVideo.get(videoId);
    if (!varr) continue;
    for (const f of varr) {
      const meta = bundle.entities.get(f.entityId);
      if (!meta || meta.type !== type) continue;
      totals.set(f.entityId, (totals.get(f.entityId) || 0) + f.count);
    }
  }

  const rows: FacetRow[] = [];
  for (const [entityId, total] of totals) {
    const meta = bundle.entities.get(entityId)!;
    rows.push({ entityId, canonical: meta.canonical, type: meta.type, total });
  }
  rows.sort((a, b) => b.total - a.total);
  const top = rows.slice(0, limit);

  const pinned: FacetRow[] = [];
  if (includeIds && includeIds.size > 0) {
    const seen = new Set(top.map((r) => r.entityId));
    for (const eid of includeIds) {
      if (seen.has(eid)) continue;
      const meta = bundle.entities.get(eid);
      if (!meta) continue;
      pinned.push({
        entityId: eid,
        canonical: meta.canonical,
        type: meta.type,
        total: totals.get(eid) || 0,
        pinned: true,
      });
    }
    pinned.sort((a, b) => b.total - a.total);
  }
  return { top, pinned };
}

// Total mention count across entities of `type` in `activeVideos`.
export function totalMentionsForType(bundle: FacetBundle, type: string, activeVideos: Set<string>): number {
  let total = 0;
  for (const videoId of activeVideos) {
    const varr = bundle.factsByVideo.get(videoId);
    if (!varr) continue;
    for (const f of varr) {
      const meta = bundle.entities.get(f.entityId);
      if (!meta || meta.type !== type) continue;
      total += f.count;
    }
  }
  return total;
}
