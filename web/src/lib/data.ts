// Data fetch layer. All reads go through here. Returns null on 404.

import type {
  VideoRow,
  EntityIndexEntry,
  EntityVideosIndex,
  Transcript,
  PersistedEntities,
  PersistedRelations,
  VideoNlp,
  GraphNode,
  GraphEdge,
} from "../types";
import { adaptNlp } from "./adapt-nlp";

const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(BASE + "data/" + path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Cached index data ---

interface CatalogFile {
  version: number;
  rows: Record<string, VideoRow>;
}

let catalogPromise: Promise<VideoRow[]> | null = null;

export function fetchCatalog(): Promise<VideoRow[]> {
  if (!catalogPromise) {
    catalogPromise = fetchJson<CatalogFile>("catalog/catalog.json").then((d) => {
      if (!d) return [];
      return Object.values(d.rows);
    });
  }
  return catalogPromise;
}

let entityIndexPromise: Promise<EntityIndexEntry[]> | null = null;

export function fetchEntityIndex(): Promise<EntityIndexEntry[]> {
  if (!entityIndexPromise) {
    entityIndexPromise = fetchJson<EntityIndexEntry[]>("entities/entity-index.json").then((d) => d || []);
  }
  return entityIndexPromise;
}

let entityVideosPromise: Promise<EntityVideosIndex> | null = null;

export function fetchEntityVideos(): Promise<EntityVideosIndex> {
  if (!entityVideosPromise) {
    entityVideosPromise = fetchJson<EntityVideosIndex>("entities/entity-videos.json").then((d) => d || {});
  }
  return entityVideosPromise;
}

// --- Per-video data ---

export async function fetchTranscript(videoId: string): Promise<Transcript | null> {
  return fetchJson<Transcript>(`transcripts/${videoId}.json`);
}

export async function fetchVideoNlp(videoId: string): Promise<VideoNlp | null> {
  const [ents, rels] = await Promise.all([
    fetchJson<PersistedEntities>(`entities/${videoId}.json`),
    fetchJson<PersistedRelations>(`relations/${videoId}.json`),
  ]);
  if (!ents) return null;
  return adaptNlp(ents, rels);
}

// --- Graph data ---

interface RelationshipsGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

let graphPromise: Promise<RelationshipsGraph | null> | null = null;

export function fetchRelationshipsGraph(): Promise<RelationshipsGraph | null> {
  if (!graphPromise) {
    graphPromise = fetchJson<RelationshipsGraph>("graph/relationships-graph.json");
  }
  return graphPromise;
}
