// Builtin pipeline stages.
//
// Per-video stages:
//   fetched   — downloads transcript via ingest/fetchAndStore
//   nlp       — runs entity + relationship extraction, persists per-video
//               JSON AND upserts into the graph store. Bumps graph.dirtyAt.
//   ai        — writes a Claude-Code enrichment bundle. If the operator has
//               placed a matching response JSON, ingests it. Otherwise the
//               stage returns `awaiting` and is re-tried next run.
//   per-claim — extracts verdict claims from the transcript's summary region
//               and attaches truthiness to matching graph relationships.
//
// Graph-level stages:
//   propagation    — truth propagation over the whole graph
//   contradictions — loop + contradiction detection
//   novel          — novel-link surfacing
//
// Graph stages read the `graph.dirtyAt` watermark. A stage is stale when its
// last-run timestamp is older than dirtyAt (or absent).

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogRow } from "../catalog/catalog.js";
import { VideoStage, GraphStage, StageOutcome } from "./types.js";
import { fetchAndStore } from "../ingest/transcript.js";
import { recordSuccess, recordFailure } from "../catalog/gaps.js";
import {
  readPersistedEntities,
  runEntitiesStage,
  type Transcript,
} from "../entities/index.js";
import { readPersistedRelations, runRelationsStage } from "../relations/index.js";
import {
  readPersistedDerivedDates,
  runDateNormalizeStage,
} from "../date_normalize/index.js";
import { neuralToGraph } from "../graph/adapt.js";
import {
  buildCorpusEntities,
  buildMergeClusters,
  readAliases,
} from "../graph/canonicalize.js";
import {
  EntityIndexEntry,
  EntityVideosIndex,
  writePersistedEntityIndex,
  writePersistedEntityVideos,
} from "../graph/entity-index-persist.js";
import {
  buildBundle,
  writeBundles,
  ingestResponseFile,
} from "../ai/enrich.js";
import { extractClaims, attachTruthiness } from "../truth/per-claim.js";
import { propagate } from "../truth/propagation.js";
import { buildConflictReport } from "../truth/contradictions.js";
import { detectNovel } from "../truth/novel.js";
import { logger } from "../shared/logger.js";

// Helper: load a parsed transcript from disk or return null.
function loadTranscript(row: CatalogRow, dataDir: string): Transcript | null {
  const p = row.transcriptPath ?? join(dataDir, "transcripts", `${row.videoId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Transcript;
  } catch {
    return null;
  }
}

export const fetchedStage: VideoStage = {
  name: "fetched",
  dependsOn: [],
  async run(row, ctx): Promise<StageOutcome> {
    // Skip rows that the user marked as unrecoverable until they flip back
    // to pending via resetFailed() or explicit re-add.
    if (row.status === "failed-needs-user") {
      return { kind: "skip", reason: "needs user; row marked failed-needs-user" };
    }
    try {
      const stored = await fetchAndStore(row.videoId, { dataDir: ctx.dataDir });
      if (stored.cached) {
        // Gold-transcript path. The file was already on disk; do not bump
        // `fetched.at` on every tick. If the stage record is missing —
        // e.g. catalog.json was rebuilt after the transcript — backfill it
        // using the transcript file's mtime so downstream cascading still
        // works. Return `skip` so the runner does not overwrite the record.
        if (!row.stages?.fetched) {
          const mtime = statSync(stored.path).mtimeMs;
          recordSuccess(
            ctx.catalog,
            row.videoId,
            stored.path,
            stored.meta,
            new Date(mtime).toISOString(),
          );
        }
        return { kind: "skip", reason: "transcript already on disk" };
      }
      recordSuccess(ctx.catalog, row.videoId, stored.path, stored.meta);
      return { kind: "ok" };
    } catch (e) {
      const err = e as Error;
      recordFailure(ctx.catalog, row.videoId, "retryable", err.message);
      return { kind: "skip", reason: `fetch failed: ${err.message}` };
    }
  },
};

// Neural entity extraction — replaces the legacy nlpStage. Runs GLiNER
// via tools/gliner_sidecar.py, canonicalizes mentions intra-transcript,
// and writes data/entities/<id>.json. Upserts the adapted Entity
// records into the graph store and invalidates AI artifacts (the
// bundle may reference stale entity ids).
export const entitiesStage: VideoStage = {
  name: "entities",
  dependsOn: ["fetched"],
  async run(row, ctx): Promise<StageOutcome> {
    const outcome = await runEntitiesStage(
      { videoId: row.videoId, transcriptPath: row.transcriptPath },
      { dataDir: ctx.dataDir, repoRoot: process.cwd() },
    );
    if (outcome.kind === "skip") {
      return { kind: "skip", reason: outcome.reason ?? "entities skipped" };
    }

    const persisted = readPersistedEntities(row.videoId, ctx.dataDir);
    if (!persisted) {
      return { kind: "skip", reason: "entities output not persisted" };
    }

    // AI bundle may reference stale entity ids; nuke it and mark any
    // existing response stale.
    invalidateAiArtifacts(row.videoId, ctx.dataDir);

    const { entities } = neuralToGraph(persisted, null);
    const store = ctx.getStore();
    store.registerTranscript(row.videoId);
    for (const e of entities) store.upsertEntity(e);
    ctx.catalog.markGraphDirty();

    return {
      kind: "ok",
      notes: `${persisted.mentions.length} mentions · ${entities.length} entities`,
    };
  },
};

// Normalize GLiNER date_time mentions into derived entity types
// (time_of_day / specific_date_time / specific_week / specific_month /
// year / decade). Purely derivational — no model call, no transcript
// read. Output goes to data/date-normalize/<id>.json as a sidecar;
// the entities file is never mutated.
export const dateNormalizeStage: VideoStage = {
  name: "date-normalize",
  dependsOn: ["entities"],
  async run(row, ctx): Promise<StageOutcome> {
    const outcome = await runDateNormalizeStage(
      { videoId: row.videoId },
      { dataDir: ctx.dataDir },
    );
    if (outcome.kind === "skip") {
      return { kind: "skip", reason: outcome.reason ?? "date-normalize skipped" };
    }

    const derived = readPersistedDerivedDates(row.videoId, ctx.dataDir);
    if (!derived) {
      return { kind: "skip", reason: "derived-dates output not persisted" };
    }

    // AI bundle was built against the prior entity set.
    invalidateAiArtifacts(row.videoId, ctx.dataDir);

    // Do NOT upsert derived entities into graph.json here. The
    // propagation / contradictions / novel graph stages only care about
    // relationships (derived entities are never relation endpoints),
    // and the indexes stage rebuilds entity-index.json from per-video
    // files directly. Writing 55+ MB of graph.json for every mention
    // would dominate pipeline runtime with no downstream consumer.
    ctx.catalog.markGraphDirty();

    return {
      kind: "ok",
      notes: `${derived.mentions.length} derived mentions`,
    };
  },
};

// Neural relation extraction — replaces the regex relationship
// extractor. Reads data/entities/<id>.json produced by entitiesStage,
// runs GLiREL via tools/glirel_sidecar.py in one batched spawn per
// transcript, writes data/relations/<id>.json, and upserts the adapted
// Relationship records into the graph store.
export const relationsStage: VideoStage = {
  name: "relations",
  dependsOn: ["entities"],
  async run(row, ctx): Promise<StageOutcome> {
    const outcome = await runRelationsStage(
      { videoId: row.videoId, transcriptPath: row.transcriptPath },
      { dataDir: ctx.dataDir, repoRoot: process.cwd() },
    );
    if (outcome.kind === "skip") {
      return { kind: "skip", reason: outcome.reason ?? "relations skipped" };
    }

    const persistedEntities = readPersistedEntities(row.videoId, ctx.dataDir);
    const persistedRelations = readPersistedRelations(row.videoId, ctx.dataDir);
    if (!persistedEntities || !persistedRelations) {
      return { kind: "skip", reason: "relations output not persisted" };
    }

    invalidateAiArtifacts(row.videoId, ctx.dataDir);

    const { relationships } = neuralToGraph(persistedEntities, persistedRelations);
    const store = ctx.getStore();
    store.registerTranscript(row.videoId);
    for (const r of relationships) {
      try {
        store.upsertRelationship(r);
      } catch (err) {
        logger.warn("pipeline.relations.upsert-skip", {
          videoId: row.videoId,
          relId: r.id,
          message: (err as Error).message,
        });
      }
    }
    ctx.catalog.markGraphDirty();

    return {
      kind: "ok",
      notes: `${persistedRelations.edges.length} edges · ${relationships.length} relationships`,
    };
  },
};

function bundleDir(dataDir: string): string {
  return join(dataDir, "ai", "bundles");
}
function responseDir(dataDir: string): string {
  return join(dataDir, "ai", "responses");
}

// Called by entitiesStage / relationsStage after they regenerate
// per-video output. The AI bundle and the AI response were both built
// against the previous run and their entity ids may no longer match.
// We unlink the bundle (aiStage will regenerate it on its next tick)
// but preserve the response — it is operator labor. Instead, stamp a
// top-level `_stale` marker into the response JSON so the admin UI
// and CLI can flag it for review.
function invalidateAiArtifacts(videoId: string, dataDir: string): void {
  const bundlePath = join(bundleDir(dataDir), `${videoId}.bundle.json`);
  if (existsSync(bundlePath)) {
    try {
      unlinkSync(bundlePath);
    } catch (err) {
      logger.warn("pipeline.entities.bundle-unlink-failed", {
        videoId,
        message: (err as Error).message,
      });
    }
  }
  const responsePath = join(responseDir(dataDir), `${videoId}.response.json`);
  if (existsSync(responsePath)) {
    try {
      const raw = JSON.parse(readFileSync(responsePath, "utf8")) as Record<string, unknown>;
      const now = new Date().toISOString();
      raw._stale = {
        since: now,
        reason: "neural extraction regenerated; entity ids may no longer match",
        nlpAt: now,
      };
      writeFileSync(responsePath, JSON.stringify(raw, null, 2), "utf8");
    } catch (err) {
      logger.warn("pipeline.entities.response-mark-failed", {
        videoId,
        message: (err as Error).message,
      });
    }
  }
}

export const aiStage: VideoStage = {
  name: "ai",
  dependsOn: ["relations"],
  async run(row, ctx): Promise<StageOutcome> {
    const responsePath = join(
      responseDir(ctx.dataDir),
      `${row.videoId}.response.json`,
    );
    const dir = bundleDir(ctx.dataDir);
    const bundlePath = join(dir, `${row.videoId}.bundle.json`);

    // Fast path: bundle already on disk and no response yet. Re-deriving
    // entities would burn cycles every pipeline tick just to re-produce
    // a bundle we already wrote.
    if (!existsSync(responsePath) && existsSync(bundlePath)) {
      return {
        kind: "awaiting",
        notes: `bundle already written; waiting for ${responsePath}`,
      };
    }

    const t = loadTranscript(row, ctx.dataDir);
    if (!t) return { kind: "skip", reason: "transcript file missing" };

    const persisted = readPersistedEntities(row.videoId, ctx.dataDir);
    if (!persisted) {
      return {
        kind: "skip",
        reason: "entities stage output missing — run entities first",
      };
    }
    const { entities } = neuralToGraph(persisted, null);

    if (existsSync(responsePath)) {
      // Operator has dropped a Claude Code response in place. Ingest it
      // and mark the stage complete.
      const store = ctx.getStore();
      store.registerTranscript(row.videoId);
      for (const e of entities) store.upsertEntity(e);
      const added = ingestResponseFile(store, t, responsePath);
      ctx.catalog.markGraphDirty();
      return { kind: "ok", notes: `ingested ${added.length} AI edges` };
    }

    // No bundle yet: write it and start awaiting.
    mkdirSync(dir, { recursive: true });
    writeBundles(dir, [buildBundle(t, entities)]);
    return {
      kind: "awaiting",
      notes: `bundle written to ${bundlePath}; waiting for ${responsePath}`,
    };
  },
};

export const perClaimStage: VideoStage = {
  name: "per-claim",
  dependsOn: ["relations"],
  async run(row, ctx): Promise<StageOutcome> {
    const t = loadTranscript(row, ctx.dataDir);
    if (!t) return { kind: "skip", reason: "transcript file missing" };
    const store = ctx.getStore();
    // attachTruthiness reads existing relationships, so the graph must be
    // populated by nlp/ai first. It's an in-graph write, so bump dirtyAt.
    const claims = extractClaims(t);
    const updated = attachTruthiness(store, t, claims);
    if (updated.length > 0) ctx.catalog.markGraphDirty();
    return {
      kind: "ok",
      notes: `${claims.length} claims, ${updated.length} relationships updated`,
    };
  },
};

export const propagationStage: GraphStage = {
  name: "propagation",
  async run(ctx): Promise<StageOutcome> {
    const res = propagate(ctx.getStore());
    return {
      kind: "ok",
      notes: `iterations=${res.iterations} updated=${res.updated}`,
    };
  },
};

export const contradictionsStage: GraphStage = {
  name: "contradictions",
  async run(ctx): Promise<StageOutcome> {
    const report = buildConflictReport(ctx.getStore());
    const dir = join(ctx.dataDir, "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "conflicts.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    return {
      kind: "ok",
      notes: `contradictions=${report.contradictions.length} loops=${report.loops.length}`,
    };
  },
};

// Aggregates per-video neural output into the corpus-wide files the
// UI (and static deploy shim) read: entity-index.json,
// entity-videos.json, and relationships-graph.json. Runs at graph
// level so one pass covers the whole catalog after any
// entities-or-relations-producing stage has touched dirtyAt.
export const indexesStage: GraphStage = {
  name: "indexes",
  async run(ctx): Promise<StageOutcome> {
    // Step 0: cross-transcript canonicalization. Build transitive merge
    // clusters from substring containment, fold in the operator-curated
    // aliases file, and write the resolved map. The alias map is then
    // used by neuralToGraph() below so merged entities share one graph
    // node.
    // Read the operator-curated alias map. buildMergeClusters respects
    // "not same" pairs so it won't re-propose rejected merges.
    const aliases = readAliases(ctx.dataDir);
    const corpus = buildCorpusEntities(ctx.dataDir);
    buildMergeClusters(corpus, aliases); // side effect: writes nothing, just clusters
    // aliases is the source of truth — written by the admin page, read here.

    const agg = new Map<string, EntityIndexEntry>();
    const videosByEntity: EntityVideosIndex = {};
    const graphNodes = new Map<
      string,
      { id: string; type: string; canonical: string; weight: number }
    >();
    const graphEdges = new Map<
      string,
      { id: string; source: string; target: string; predicate: string; count: number }
    >();
    let processed = 0;
    for (const row of ctx.catalog.all()) {
      if (row.status !== "fetched") continue;
      const persistedEntities = readPersistedEntities(
        row.videoId,
        ctx.dataDir,
      );
      if (!persistedEntities) continue;
      const persistedRelations = readPersistedRelations(
        row.videoId,
        ctx.dataDir,
      );
      const derivedDates = readPersistedDerivedDates(row.videoId, ctx.dataDir);
      const { entities, relationships } = neuralToGraph(
        persistedEntities,
        persistedRelations,
        aliases,
        derivedDates,
      );
      processed += 1;
      const entById = new Map(entities.map((e) => [e.id, e]));
      for (const rel of relationships) {
        const s = entById.get(rel.subjectId);
        const o = entById.get(rel.objectId);
        if (!s || !o) continue;
        for (const ent of [s, o]) {
          const existing = graphNodes.get(ent.id);
          if (existing) existing.weight += 1;
          else
            graphNodes.set(ent.id, {
              id: ent.id,
              type: ent.type,
              canonical: ent.canonical,
              weight: 1,
            });
        }
        const key = `${rel.subjectId}|${rel.predicate}|${rel.objectId}`;
        const existingEdge = graphEdges.get(key);
        if (existingEdge) existingEdge.count += 1;
        else
          graphEdges.set(key, {
            id: key,
            source: rel.subjectId,
            target: rel.objectId,
            predicate: rel.predicate,
            count: 1,
          });
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
    }
    writePersistedEntityIndex([...agg.values()], ctx.dataDir);
    writePersistedEntityVideos(videosByEntity, ctx.dataDir);
    const graph = {
      nodes: [...graphNodes.values()],
      edges: [...graphEdges.values()],
    };
    // Keep the aggregated graph file next to the other graph data on
    // disk so the static deploy shim still finds it at a predictable
    // location.
    const dir = join(ctx.dataDir, "graph");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "relationships-graph.json"),
      JSON.stringify(graph),
      "utf8",
    );
    return {
      kind: "ok",
      notes: `videos=${processed} entities=${agg.size} nodes=${graph.nodes.length} edges=${graph.edges.length}`,
    };
  },
};

export const novelStage: GraphStage = {
  name: "novel",
  async run(ctx): Promise<StageOutcome> {
    const candidates = detectNovel(ctx.getStore());
    const dir = join(ctx.dataDir, "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "novel.json"),
      JSON.stringify(candidates, null, 2),
      "utf8",
    );
    return { kind: "ok", notes: `candidates=${candidates.length}` };
  },
};

export const DEFAULT_VIDEO_STAGES: VideoStage[] = [
  fetchedStage,
  entitiesStage,
  dateNormalizeStage,
  relationsStage,
  aiStage,
  perClaimStage,
];

// The legacy regex+BERT `nlpStage` was retired once the neural eval
// passed. Its replacement is the entities + relations pair above.
// Legacy catalog rows may still carry a `stages.nlp` record from the
// old pipeline; those records are ignored (no stage listens for the
// "nlp" name any more) and can be cleared with
//  `captions delete --stage nlp`.
// here (entities depends on "fetched", relations depends on "entities",
// ai then depends on "relations" instead of "nlp"). Once that lands,
// delete nlpStage and src/nlp/ in the same commit.

export const DEFAULT_GRAPH_STAGES: GraphStage[] = [
  propagationStage,
  contradictionsStage,
  novelStage,
  indexesStage,
];
