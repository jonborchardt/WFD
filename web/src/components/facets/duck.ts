// Query layer for the facets page — adapted from src/ui/client/facets/duck.ts
// Uses static data fetchers instead of /api/* endpoints.

import type { VideoRow } from "../../types";
import { fetchCatalog, fetchEntityIndex, fetchEntityVideos } from "../../lib/data";

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

let loadPromise: Promise<FacetBundle> | null = null;

export function loadFacetData(): Promise<FacetBundle> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [catalog, entityIndex, entityVideosRaw] = await Promise.all([
      fetchCatalog(),
      fetchEntityIndex(),
      fetchEntityVideos(),
    ]);

    const videos = catalog.filter((r) => r.status === "fetched");
    const videoById = new Map<string, VideoRow>(videos.map((r) => [r.videoId, r]));

    const entities = new Map<string, EntityMeta>();
    for (const e of entityIndex) {
      entities.set(e.id, { id: e.id, type: e.type, canonical: e.canonical });
    }

    const facts: Fact[] = [];
    const factsByEntity = new Map<string, Fact[]>();
    const factsByVideo = new Map<string, Fact[]>();
    const typeTotals = new Map<string, number>();

    const evEntries = Object.entries(entityVideosRaw);
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

export function topEntitiesForType(
  bundle: FacetBundle,
  type: string,
  activeVideos: Set<string>,
  limit = 25,
  includeIds: Set<string> | null = null,
  excludeIds: Set<string> | null = null,
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
    if (excludeIds && excludeIds.has(entityId)) continue;
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
