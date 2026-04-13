// Precompute NLP for every fetched transcript and persist to data/nlp/.
//
// Run manually after ingestion (npm run build:nlp). Writes one file per video
// under data/nlp/<videoId>.json plus data/nlp/entity-index.json aggregating
// all entities across the corpus.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog } from "../src/catalog/catalog.js";
import { extract as extractEntities, Transcript as NlpTranscript } from "../src/nlp/entities.js";
import { extractRelationships } from "../src/nlp/relationships.js";
import { transcriptPath } from "../src/ingest/transcript.js";
import {
  EntityIndexEntry,
  EntityVideosIndex,
  writePersistedEntityIndex,
  writePersistedEntityVideos,
  writePersistedNlp,
} from "../src/nlp/persist.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const dataDir = join(repoRoot, "data");

function loadTranscript(row: { videoId: string; transcriptPath?: string }): NlpTranscript | null {
  const p = row.transcriptPath ?? transcriptPath(row.videoId, dataDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function main(): void {
  const catalog = new Catalog(Catalog.defaultPath());
  const rows = catalog.all();
  const agg = new Map<string, EntityIndexEntry>();
  const videosByEntity: EntityVideosIndex = {};
  const graphNodes = new Map<string, { id: string; type: string; canonical: string; weight: number }>();
  const graphEdges = new Map<string, { id: string; source: string; target: string; predicate: string; count: number }>();

  let processed = 0;
  for (const row of rows) {
    if (row.status !== "fetched") continue;
    const t = loadTranscript(row);
    if (!t) continue;
    const entities = extractEntities(t);
    const relationships = extractRelationships(t, entities);
    writePersistedNlp(row.videoId, { entities, relationships }, dataDir);
    const entById = new Map(entities.map((e) => [e.id, e]));
    for (const rel of relationships) {
      const s = entById.get(rel.subjectId);
      const o = entById.get(rel.objectId);
      if (!s || !o) continue;
      for (const ent of [s, o]) {
        const existing = graphNodes.get(ent.id);
        if (existing) existing.weight += 1;
        else graphNodes.set(ent.id, { id: ent.id, type: ent.type, canonical: ent.canonical, weight: 1 });
      }
      const key = `${rel.subjectId}|${rel.predicate}|${rel.objectId}`;
      const existingEdge = graphEdges.get(key);
      if (existingEdge) existingEdge.count += 1;
      else graphEdges.set(key, { id: key, source: rel.subjectId, target: rel.objectId, predicate: rel.predicate, count: 1 });
    }
    for (const e of entities) {
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
      (videosByEntity[e.id] ||= []).push({
        videoId: row.videoId,
        mentions: e.mentions,
      });
    }
    processed += 1;
  }

  writePersistedEntityIndex([...agg.values()], dataDir);
  writePersistedEntityVideos(videosByEntity, dataDir);
  const graph = { nodes: [...graphNodes.values()], edges: [...graphEdges.values()] };
  writeFileSync(join(dataDir, "nlp", "relationships-graph.json"), JSON.stringify(graph), "utf8");
  console.log(`nlp: ${processed} videos, ${agg.size} entities, ${graph.nodes.length} graph nodes, ${graph.edges.length} edges → data/nlp/`);
}

main();
