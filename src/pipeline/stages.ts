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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  entityKeyOf,
  isDeleted,
  readAliases,
  resolveKey,
} from "../graph/canonicalize.js";
import {
  readAliasesFile,
  writeAliasesFile,
} from "../graph/aliases-schema.js";
import {
  ALWAYS_PROMOTE,
  DELETE_ALWAYS,
  DELETE_LABELS,
} from "../ai/curate/delete-always.js";
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
import { buildClaimIndexes } from "../truth/claim-indexes.js";
import { computeEdgeTruth } from "../truth/edge-truth.js";
import type { Claim } from "../claims/types.js";
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
    markClaimsStale(row.videoId, ctx.dataDir, "entities regenerated");

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
    markClaimsStale(row.videoId, ctx.dataDir, "relations regenerated");

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
// Stamp a top-level `_stale` marker into data/claims/<videoId>.json when
// an upstream stage (entities, relations) regenerates. The file is never
// deleted — it represents AI session labor. The UI and CLI read the
// marker to flag the claims for re-extraction.
function markClaimsStale(videoId: string, dataDir: string, reason: string): void {
  const p = join(dataDir, "claims", `${videoId}.json`);
  if (!existsSync(p)) return;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    raw._stale = { since: new Date().toISOString(), reason };
    writeFileSync(p, JSON.stringify(raw, null, 2), "utf8");
  } catch (err) {
    logger.warn("pipeline.claims.stale-mark-failed", {
      videoId,
      message: (err as Error).message,
    });
  }
}

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
// Ensure the committed DELETE_ALWAYS + ALWAYS_PROMOTE lists are reflected
// in aliases.json before the indexes rebuild runs. Idempotent:
//   - A DELETE_ALWAYS entry is skipped if the key is already deleted or
//     already merged (the operator may have chosen a different fate).
//   - An ALWAYS_PROMOTE entry is skipped unless BOTH endpoints exist in
//     the corpus, and also skipped if `from` is already deleted / merged
//     to something else / the target of the promote.
// DELETE_ALWAYS / ALWAYS_PROMOTE / DELETE_LABELS auto-apply hook.
function applyCommittedLists(
  dataDir: string,
  corpusKeys: Set<string>,
): {
  deletedApplied: number;
  promotedApplied: number;
  deletedSkipped: number;
  promotedSkipped: number;
  labelDeletedApplied: number;
  labelDeletedSkipped: number;
} {
  const current = readAliasesFile(dataDir);
  const alreadyDeleted = new Set(current.deletedEntities.map((e) => e.key));
  const alreadyMergedFrom = new Set(current.merges.map((e) => e.from));
  const notSamePairs = new Set(
    current.notSame.map((e) => [e.a, e.b].sort().join("~~")),
  );

  // Batch all additions into a single read-modify-write. The per-key
  // `addDeletedEntity` / `addMerge` helpers each do a full rewrite which
  // is both slow and prone to filesystem contention on Windows when
  // called in a tight loop over thousands of keys.
  const file = current;

  // Whole-label deletion
  let labelDeletedApplied = 0;
  let labelDeletedSkipped = 0;
  const labelReason = new Map(DELETE_LABELS.map((e) => [e.label, e.reason]));
  for (const key of corpusKeys) {
    const colon = key.indexOf(":");
    if (colon < 0) continue;
    const label = key.slice(0, colon);
    const reason = labelReason.get(label);
    if (!reason) continue;
    if (alreadyDeleted.has(key) || alreadyMergedFrom.has(key)) {
      labelDeletedSkipped++;
      continue;
    }
    file.deletedEntities.push({ key, reason: `label:${label} ${reason}` });
    alreadyDeleted.add(key);
    labelDeletedApplied++;
  }

  // DELETE_ALWAYS list
  let deletedApplied = 0;
  let deletedSkipped = 0;
  for (const { key, reason } of DELETE_ALWAYS) {
    if (alreadyDeleted.has(key) || alreadyMergedFrom.has(key)) {
      deletedSkipped++;
      continue;
    }
    file.deletedEntities.push({ key, reason });
    alreadyDeleted.add(key);
    deletedApplied++;
  }

  let promotedApplied = 0;
  let promotedSkipped = 0;
  for (const { from, to, rationale } of ALWAYS_PROMOTE) {
    if (!corpusKeys.has(from) || !corpusKeys.has(to)) {
      promotedSkipped++;
      continue;
    }
    if (alreadyDeleted.has(from) || alreadyDeleted.has(to)) {
      promotedSkipped++;
      continue;
    }
    if (alreadyMergedFrom.has(from)) {
      promotedSkipped++;
      continue;
    }
    const pair = [from, to].sort().join("~~");
    if (notSamePairs.has(pair)) {
      promotedSkipped++;
      continue;
    }
    const entry: { from: string; to: string; rationale?: string } = { from, to };
    if (rationale && rationale.trim()) entry.rationale = rationale.trim();
    // Drop any existing merge for the same `from` (keep last-writer-wins semantics).
    file.merges = file.merges.filter((e) => e.from !== from);
    file.merges.push(entry);
    alreadyMergedFrom.add(from);
    promotedApplied++;
  }

  // Single write at the end. Any key that appears in both deletedEntities
  // and merges (rare; shouldn't happen given the guards) — purge merges
  // for deleted keys so the sentinel wins.
  if (labelDeletedApplied > 0 || deletedApplied > 0 || promotedApplied > 0) {
    const deletedKeys = new Set(file.deletedEntities.map((e) => e.key));
    file.merges = file.merges.filter((e) => !deletedKeys.has(e.from));
    writeAliasesFile(dataDir, file);
  }

  return {
    deletedApplied,
    promotedApplied,
    deletedSkipped,
    promotedSkipped,
    labelDeletedApplied,
    labelDeletedSkipped,
  };
}

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
    // Apply committed DELETE_ALWAYS + ALWAYS_PROMOTE lists BEFORE reading
    // aliases, so the flat map below reflects them.
    const initialCorpus = buildCorpusEntities(ctx.dataDir);
    const corpusKeys = new Set(initialCorpus.keys());
    const listsReport = applyCommittedLists(ctx.dataDir, corpusKeys);
    if (listsReport.deletedApplied > 0 || listsReport.promotedApplied > 0) {
      logger.info("pipeline.indexes.committed-lists", listsReport);
    }
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

// Reads every data/claims/<id>.json, runs claim propagation +
// contradiction detection, writes three corpus-wide reports alongside the
// per-video claim files:
//   data/claims/claims-index.json      flat list with derivedTruth + source tag
//   data/claims/dependency-graph.json  DAG edges
//   data/claims/contradictions.json    pair / broken-presupposition / cross-video
//
// Operator-set truth overrides and deletions (aliases sections
// claimTruthOverrides / claimDeletions) are applied before propagation so
// derived truth respects them. See src/truth/claim-indexes.ts.
export const claimIndexesStage: GraphStage = {
  name: "claim-indexes",
  async run(ctx): Promise<StageOutcome> {
    const claimsDir = join(ctx.dataDir, "claims");
    if (!existsSync(claimsDir)) {
      return { kind: "skip", reason: "data/claims/ missing" };
    }

    // Exclude the corpus-level reports that live alongside per-video
    // claim files — they would fail the `claims: Claim[]` shape check
    // anyway, but skipping them up front avoids noisy logger warnings
    // on a routine stage run.
    const CORPUS_REPORT_NAMES = new Set([
      "claims-index.json",
      "dependency-graph.json",
      "contradictions.json",
      "edge-truth.json",
      "embeddings.json",
      "contradiction-verdicts.json",
      "consonance.json",
    ]);
    const files = readdirSync(claimsDir).filter(
      (f) => f.endsWith(".json") && !CORPUS_REPORT_NAMES.has(f),
    );

    const allClaims: Claim[] = [];
    let videoCount = 0;
    for (const f of files) {
      try {
        const raw = JSON.parse(
          readFileSync(join(claimsDir, f), "utf8"),
        ) as { claims?: Claim[] };
        if (!Array.isArray(raw.claims)) continue;
        videoCount += 1;
        for (const c of raw.claims) allClaims.push(c);
      } catch (err) {
        logger.warn("pipeline.claim-indexes.read-failed", {
          file: f,
          message: (err as Error).message,
        });
      }
    }

    const aliases = readAliasesFile(ctx.dataDir);
    const aliasMap = readAliases(ctx.dataDir);
    const deletedClaimIds = new Set(
      (aliases.claimDeletions ?? []).map((e) => e.claimId),
    );
    const truthOverrides = (aliases.claimTruthOverrides ?? []).map((e) => ({
      claimId: e.claimId,
      directTruth: e.directTruth,
      rationale: e.rationale,
    }));
    const fieldOverrides = (aliases.claimFieldOverrides ?? []).map((e) => ({
      claimId: e.claimId,
      text: e.text,
      kind: e.kind as Claim["kind"] | undefined,
      hostStance: e.hostStance as Claim["hostStance"] | undefined,
      rationale: e.rationale,
    }));
    const dismissedContradictions = (aliases.contradictionDismissals ?? []).map(
      (e) => ({ a: e.a, b: e.b }),
    );
    const customContradictions = (aliases.customContradictions ?? []).map(
      (e) => ({
        a: e.a,
        b: e.b,
        summary: e.summary,
        sharedEntities: e.sharedEntities,
      }),
    );

    // Plan 04 — load the embeddings cache (if present) so the cross-video
    // candidate generator can use cosine similarity. Missing/stale cache
    // falls through to Jaccard silently.
    const embeddings = loadEmbeddingsCache(ctx.dataDir, allClaims);
    // Plan 04 — load the AI verification verdict cache (if present) so
    // contradictions.json surfaces only LOGICAL-CONTRADICTION / DEBUNKS
    // verdicts, with SAME-CLAIM verdicts promoted to consonance.json.
    const verdicts = loadVerdictsCache(ctx.dataDir);
    // Hash every claim's current text so stale verdicts (claim text
    // changed since the verdict was captured) get invalidated.
    const claimTextHash = new Map<string, string>();
    for (const c of allClaims) {
      claimTextHash.set(c.id, sha1Hex(c.text));
    }

    const result = buildClaimIndexes({
      claims: allClaims,
      videoCount,
      truthOverrides,
      deletedClaimIds,
      fieldOverrides,
      dismissedContradictions,
      customContradictions,
      embeddings,
      verdicts,
      claimTextHash,
    });

    // Build per-video "persisted edge id → aggregated graph edge id" map
    // so edge truth can join against relationships-graph.json. Alias
    // resolution here mirrors the adapter used in the `indexes` stage, so
    // both outputs agree on the final key.
    const videoIds = new Set(result.index.claims.map((c) => c.videoId));
    const perVideoEdgeToGraphEdge = new Map<string, Map<string, string>>();
    for (const vid of videoIds) {
      const persistedEntities = readPersistedEntities(vid, ctx.dataDir);
      const persistedRelations = readPersistedRelations(vid, ctx.dataDir);
      if (!persistedEntities || !persistedRelations) continue;
      const mentionToEntityKey = new Map<string, string>();
      for (const m of persistedEntities.mentions) {
        mentionToEntityKey.set(m.id, entityKeyOf(m.label, m.canonical));
      }
      const rel = new Map<string, string>();
      for (const pe of persistedRelations.edges) {
        const subjRaw = mentionToEntityKey.get(pe.subjectMentionId);
        const objRaw = mentionToEntityKey.get(pe.objectMentionId);
        if (!subjRaw || !objRaw) continue;
        if (isDeleted(subjRaw, aliasMap) || isDeleted(objRaw, aliasMap)) continue;
        const subj = resolveKey(subjRaw, aliasMap);
        const obj = resolveKey(objRaw, aliasMap);
        if (subj === obj) continue;
        rel.set(pe.id, `${subj}|${pe.predicate}|${obj}`);
      }
      perVideoEdgeToGraphEdge.set(vid, rel);
    }

    const edgeTruth = computeEdgeTruth(result.index.claims, perVideoEdgeToGraphEdge);

    writeFileSync(
      join(claimsDir, "claims-index.json"),
      JSON.stringify(result.index, null, 2),
      "utf8",
    );
    writeFileSync(
      join(claimsDir, "dependency-graph.json"),
      JSON.stringify(result.dependencyGraph, null, 2),
      "utf8",
    );
    writeFileSync(
      join(claimsDir, "contradictions.json"),
      JSON.stringify(result.contradictions, null, 2),
      "utf8",
    );
    writeFileSync(
      join(claimsDir, "edge-truth.json"),
      JSON.stringify(edgeTruth, null, 2),
      "utf8",
    );
    writeFileSync(
      join(claimsDir, "consonance.json"),
      JSON.stringify(result.consonance, null, 2),
      "utf8",
    );

    return {
      kind: "ok",
      notes:
        `videos=${videoCount} claims=${allClaims.length} ` +
        `contradictions=${result.contradictions.total} ` +
        `consonance=${result.consonance.count} ` +
        `edges-with-truth=${edgeTruth.edgeCount}`,
    };
  },
};

// Plan 04 helpers — embeddings + verdict cache loaders for the
// claim-indexes stage. Both are graceful: missing / stale / unreadable
// cache returns an empty map, and the detector falls back to Jaccard
// or treats every candidate as pending-verified.
function loadEmbeddingsCache(
  dataDir: string,
  claims: Claim[],
): Map<string, Float32Array | number[]> | undefined {
  const p = join(dataDir, "claims", "embeddings.json");
  if (!existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      schemaVersion?: number;
      modelId?: string;
      dimensions?: number;
      entries?: Record<string, number[]>;
    };
    if (parsed.schemaVersion !== 1 || !parsed.modelId || !parsed.entries) {
      return undefined;
    }
    const out = new Map<string, number[]>();
    for (const c of claims) {
      const hash = sha1Hex(`${parsed.modelId}\u0000${c.text}`);
      const vec = parsed.entries[hash];
      if (vec && vec.length > 0) out.set(c.id, vec);
    }
    return out.size > 0 ? out : undefined;
  } catch (err) {
    logger.warn("pipeline.claim-indexes.embeddings-read-failed", {
      message: (err as Error).message,
    });
    return undefined;
  }
}

function loadVerdictsCache(
  dataDir: string,
): Map<string, import("../truth/claim-indexes.js").VerdictCacheEntry> | undefined {
  const p = join(dataDir, "claims", "contradiction-verdicts.json");
  if (!existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      verdicts?: import("../truth/claim-indexes.js").VerdictCacheEntry[];
    };
    if (!Array.isArray(parsed.verdicts)) return undefined;
    const out = new Map<string, import("../truth/claim-indexes.js").VerdictCacheEntry>();
    for (const v of parsed.verdicts) {
      if (!v.left || !v.right || !v.verdict) continue;
      const [lo, hi] = v.left < v.right ? [v.left, v.right] : [v.right, v.left];
      out.set(`${lo}~~${hi}`, v);
    }
    return out;
  } catch (err) {
    logger.warn("pipeline.claim-indexes.verdicts-read-failed", {
      message: (err as Error).message,
    });
    return undefined;
  }
}

// Small SHA-1 hex digest — used both for embedding cache lookup (model+text)
// and for claim-text invalidation in the verdict cache.
function sha1Hex(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}


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
  claimIndexesStage,
];
