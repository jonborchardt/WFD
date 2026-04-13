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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogRow } from "../catalog/catalog.js";
import { VideoStage, GraphStage, StageOutcome } from "./types.js";
import { fetchAndStore } from "../ingest/transcript.js";
import { recordSuccess, recordFailure } from "../catalog/gaps.js";
import { extract as extractEntities, Transcript } from "../nlp/entities.js";
import { extractRelationships } from "../nlp/relationships.js";
import { writePersistedNlp } from "../nlp/persist.js";
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
  version: 1,
  dependsOn: [],
  async run(row, ctx): Promise<StageOutcome> {
    // Skip rows that the user marked as unrecoverable until they flip back
    // to pending via resetFailed() or explicit re-add.
    if (row.status === "failed-needs-user") {
      return { kind: "skip", reason: "needs user; row marked failed-needs-user" };
    }
    try {
      const stored = await fetchAndStore(row.videoId, { dataDir: ctx.dataDir });
      recordSuccess(ctx.catalog, row.videoId, stored.path, stored.meta);
      return { kind: "ok" };
    } catch (e) {
      const err = e as Error;
      recordFailure(ctx.catalog, row.videoId, "retryable", err.message);
      return { kind: "skip", reason: `fetch failed: ${err.message}` };
    }
  },
};

export const nlpStage: VideoStage = {
  name: "nlp",
  version: 1,
  dependsOn: ["fetched"],
  async run(row, ctx): Promise<StageOutcome> {
    const t = loadTranscript(row, ctx.dataDir);
    if (!t) return { kind: "skip", reason: "transcript file missing" };
    const entities = extractEntities(t);
    const relationships = extractRelationships(t, entities);
    writePersistedNlp(row.videoId, { entities, relationships }, ctx.dataDir);

    // Upsert into the graph store so graph-level stages see NLP output, not
    // only AI output. This is the behavioral improvement that the old
    // build-nlp script did not perform.
    const store = ctx.getStore();
    store.registerTranscript(row.videoId);
    for (const e of entities) store.upsertEntity(e);
    for (const r of relationships) {
      try {
        store.upsertRelationship(r);
      } catch (err) {
        logger.warn("pipeline.nlp.upsert-skip", {
          videoId: row.videoId,
          relId: r.id,
          message: (err as Error).message,
        });
      }
    }
    // Any graph write must bump the watermark.
    ctx.catalog.markGraphDirty();
    return {
      kind: "ok",
      notes: `${entities.length} entities, ${relationships.length} relationships`,
    };
  },
};

function bundleDir(dataDir: string): string {
  return join(dataDir, "ai", "bundles");
}
function responseDir(dataDir: string): string {
  return join(dataDir, "ai", "responses");
}

export const aiStage: VideoStage = {
  name: "ai",
  version: 1,
  dependsOn: ["nlp"],
  async run(row, ctx): Promise<StageOutcome> {
    const t = loadTranscript(row, ctx.dataDir);
    if (!t) return { kind: "skip", reason: "transcript file missing" };
    const entities = extractEntities(t);
    const responsePath = join(
      responseDir(ctx.dataDir),
      `${row.videoId}.response.json`,
    );

    if (existsSync(responsePath)) {
      // Operator has dropped a Claude Code response in place. Ingest it and
      // mark the stage complete.
      const store = ctx.getStore();
      store.registerTranscript(row.videoId);
      for (const e of entities) store.upsertEntity(e);
      const added = ingestResponseFile(store, t, responsePath);
      ctx.catalog.markGraphDirty();
      return { kind: "ok", notes: `ingested ${added.length} AI edges` };
    }

    // Otherwise, ensure the prompt bundle exists and wait for a response.
    const dir = bundleDir(ctx.dataDir);
    mkdirSync(dir, { recursive: true });
    const bundlePath = join(dir, `${row.videoId}.bundle.json`);
    if (!existsSync(bundlePath)) {
      writeBundles(dir, [buildBundle(t, entities)]);
      return {
        kind: "awaiting",
        notes: `bundle written to ${bundlePath}; waiting for ${responsePath}`,
      };
    }
    return {
      kind: "awaiting",
      notes: `bundle already written; waiting for ${responsePath}`,
    };
  },
};

export const perClaimStage: VideoStage = {
  name: "per-claim",
  version: 1,
  dependsOn: ["nlp"],
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
  version: 1,
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
  version: 1,
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

export const novelStage: GraphStage = {
  name: "novel",
  version: 1,
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
  nlpStage,
  aiStage,
  perClaimStage,
];

export const DEFAULT_GRAPH_STAGES: GraphStage[] = [
  propagationStage,
  contradictionsStage,
  novelStage,
];
