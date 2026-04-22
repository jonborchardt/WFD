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
  PersistedClaims,
  ClaimsIndexFile,
  DependencyGraphFile,
  ContradictionsFile,
  EdgeTruthFile,
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

// --- Claims (Plan 5) ---

export async function fetchClaims(videoId: string): Promise<PersistedClaims | null> {
  return fetchJson<PersistedClaims>(`claims/${videoId}.json`);
}

let claimsIndexPromise: Promise<ClaimsIndexFile | null> | null = null;

export function fetchClaimsIndex(): Promise<ClaimsIndexFile | null> {
  if (!claimsIndexPromise) {
    claimsIndexPromise = fetchJson<ClaimsIndexFile>("claims/claims-index.json");
  }
  return claimsIndexPromise;
}

let dependencyGraphPromise: Promise<DependencyGraphFile | null> | null = null;

export function fetchDependencyGraph(): Promise<DependencyGraphFile | null> {
  if (!dependencyGraphPromise) {
    dependencyGraphPromise = fetchJson<DependencyGraphFile>(
      "claims/dependency-graph.json",
    );
  }
  return dependencyGraphPromise;
}

let contradictionsPromise: Promise<ContradictionsFile | null> | null = null;

export function fetchContradictions(): Promise<ContradictionsFile | null> {
  if (!contradictionsPromise) {
    contradictionsPromise = fetchJson<ContradictionsFile>(
      "claims/contradictions.json",
    );
  }
  return contradictionsPromise;
}

let edgeTruthPromise: Promise<EdgeTruthFile | null> | null = null;

export function fetchEdgeTruth(): Promise<EdgeTruthFile | null> {
  if (!edgeTruthPromise) {
    edgeTruthPromise = fetchJson<EdgeTruthFile>("claims/edge-truth.json");
  }
  return edgeTruthPromise;
}

// Bust every cached corpus-level promise that reflects claim/contradiction
// state. Callers mutate via /api/aliases/* then call this + re-fetch the
// specific data they render, instead of doing window.location.reload().
export function invalidateClaimsCaches(): void {
  claimsIndexPromise = null;
  dependencyGraphPromise = null;
  contradictionsPromise = null;
  edgeTruthPromise = null;
}
