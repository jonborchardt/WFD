// Contradiction / consonance / verdict metrics (Plan 05). Reflects
// Plan 04 outcomes — pair vs cross-video counts, verified-ratio,
// pending-queue size, consonance yield, embedding-cache coverage.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metric, MetricSection } from "./types.js";

interface ContradictionsFile {
  contradictions?: Array<{
    kind?: string;
    verified?: { verdict?: string } | null;
  }>;
  byKind?: Record<string, number>;
  verifiedDropped?: { total?: number; byVerdict?: Record<string, number> };
  total?: number;
}

interface ConsonanceFile {
  count?: number;
  agreements?: Array<unknown>;
}

interface VerdictsFile {
  verdicts?: Array<{ verdict?: string; by?: string }>;
  byVerdict?: Record<string, number>;
  count?: number;
}

interface EmbeddingsFile {
  schemaVersion?: number;
  modelId?: string;
  dimensions?: number;
  entries?: Record<string, number[]>;
}

function tryRead<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

export const contradictionsSection: MetricSection = {
  section: "contradictions",
  compute(dataDir: string): Metric[] {
    const c = tryRead<ContradictionsFile>(join(dataDir, "claims", "contradictions.json"));
    const cons = tryRead<ConsonanceFile>(join(dataDir, "claims", "consonance.json"));
    const verdicts = tryRead<VerdictsFile>(join(dataDir, "claims", "contradiction-verdicts.json"));
    const embeddings = tryRead<EmbeddingsFile>(join(dataDir, "claims", "embeddings.json"));

    const contradictionsList = c?.contradictions ?? [];
    const byKind: Record<string, number> = {};
    let pending = 0;
    for (const x of contradictionsList) {
      const k = x.kind ?? "unknown";
      byKind[k] = (byKind[k] ?? 0) + 1;
      // Only pair / cross-video entries go through AI verification —
      // broken-presupposition is mechanically derived and always lands
      // with verified === undefined, which would spuriously inflate
      // the pending count otherwise.
      if (k !== "broken-presupposition" && k !== "manual") {
        if (x.verified === null || x.verified === undefined) pending++;
      }
    }

    const verdictList = verdicts?.verdicts ?? [];
    const verdictByKind: Record<string, number> = {};
    let operatorVerdicts = 0;
    for (const v of verdictList) {
      const k = v.verdict ?? "unknown";
      verdictByKind[k] = (verdictByKind[k] ?? 0) + 1;
      if (v.by === "operator") operatorVerdicts++;
    }

    const embCount = embeddings?.entries ? Object.keys(embeddings.entries).length : 0;
    const embDims = embeddings?.dimensions ?? null;

    return [
      { section: "contradictions", name: "contradictions.total",
        value: c ? contradictionsList.length : null, unit: "count",
        description: "rows in data/claims/contradictions.json (post-verdict filter)",
        source: "data/claims/contradictions.json" },
      { section: "contradictions", name: "contradictions.pair",
        value: c ? (byKind.pair ?? 0) : null, unit: "count",
        description: "pair contradictions surfaced (logical + debunks; both asserted true)",
        source: "data/claims/contradictions.json" },
      { section: "contradictions", name: "contradictions.crossVideo",
        value: c ? (byKind["cross-video"] ?? 0) : null, unit: "count",
        description: "cross-video contradictions surfaced",
        source: "data/claims/contradictions.json" },
      { section: "contradictions", name: "contradictions.brokenPresupposition",
        value: c ? (byKind["broken-presupposition"] ?? 0) : null, unit: "count",
        description: "broken-presupposition contradictions (mechanically derived)",
        source: "data/claims/contradictions.json" },
      { section: "contradictions", name: "contradictions.pendingVerify",
        value: c ? pending : null, unit: "count",
        description: "candidates still awaiting AI verification (target: 0 on production)",
        source: "data/claims/contradictions.json" },
      { section: "contradictions", name: "verdicts.total",
        value: verdicts ? verdictList.length : null, unit: "count",
        description: "entries in data/claims/contradiction-verdicts.json",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.logicalContradiction",
        value: verdicts ? (verdictByKind["LOGICAL-CONTRADICTION"] ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.debunks",
        value: verdicts ? (verdictByKind.DEBUNKS ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.undercuts",
        value: verdicts ? (verdictByKind.UNDERCUTS ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.alternative",
        value: verdicts ? (verdictByKind.ALTERNATIVE ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.complementary",
        value: verdicts ? (verdictByKind.COMPLEMENTARY ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.irrelevant",
        value: verdicts ? (verdictByKind.IRRELEVANT ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.sameClaim",
        value: verdicts ? (verdictByKind["SAME-CLAIM"] ?? 0) : null, unit: "count",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "verdicts.operator",
        value: verdicts ? operatorVerdicts : null, unit: "count",
        description: "verdicts authored by the operator (outrank AI)",
        source: "data/claims/contradiction-verdicts.json" },
      { section: "contradictions", name: "consonance.count",
        value: cons ? (cons.agreements?.length ?? cons.count ?? 0) : null, unit: "count",
        description: "cross-video SAME-CLAIM agreements surfaced on /cross-video-agreements",
        source: "data/claims/consonance.json" },
      { section: "contradictions", name: "embeddings.cached",
        value: embCount, unit: "count",
        description: "claim texts with a sentence embedding in the cache",
        source: "data/claims/embeddings.json" },
      { section: "contradictions", name: "embeddings.dimensions",
        value: embDims, unit: "count",
        description: "embedding model dimensionality",
        source: "data/claims/embeddings.json" },
    ];
  },
};
