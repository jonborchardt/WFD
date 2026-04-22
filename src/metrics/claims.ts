// Claims-quality metrics (Plan 05). Reflects Plan 03 v2 targets —
// evidence tightness, denies coverage, dependency coverage, typed
// contradicts subkind coverage, calibrated directTruth.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Claim, PersistedClaims } from "../claims/types.js";
import { parseContradictsSubkind } from "../truth/contradicts-subkind.js";
import type { Metric, MetricSection } from "./types.js";

const RESERVED_CLAIM_FILES = new Set([
  "claims-index.json",
  "dependency-graph.json",
  "contradictions.json",
  "edge-truth.json",
  "embeddings.json",
  "contradiction-verdicts.json",
  "consonance.json",
]);

function loadAllClaims(dataDir: string): Claim[] {
  const dir = join(dataDir, "claims");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !RESERVED_CLAIM_FILES.has(f),
  );
  const out: Claim[] = [];
  for (const f of files) {
    let j: PersistedClaims;
    try { j = JSON.parse(readFileSync(join(dir, f), "utf8")) as PersistedClaims; } catch { continue; }
    if (!Array.isArray(j.claims)) continue;
    for (const c of j.claims) out.push(c);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

export const claimsSection: MetricSection = {
  section: "claims",
  compute(dataDir: string): Metric[] {
    const claims = loadAllClaims(dataDir);
    const total = claims.length;
    if (total === 0) {
      // File layout is present but no claim files — emit null metrics so
      // the baseline / gate knows they're uncomputable.
      return [
        { section: "claims", name: "claims.total", value: 0, unit: "count" },
        { section: "claims", name: "claims.avgPerVideo", value: null, unit: "count" },
        { section: "claims", name: "claims.directTruthPct", value: null, unit: "pct" },
        { section: "claims", name: "claims.deniesPct", value: null, unit: "pct" },
        { section: "claims", name: "claims.dependencyCoveragePct", value: null, unit: "pct" },
        { section: "claims", name: "claims.evidenceP50Chars", value: null, unit: "chars" },
        { section: "claims", name: "claims.evidenceP90Chars", value: null, unit: "chars" },
        { section: "claims", name: "claims.evidenceMaxChars", value: null, unit: "chars" },
        { section: "claims", name: "claims.contradictsSubkindPct", value: null, unit: "pct" },
      ];
    }

    // File-level stats
    const videoIds = new Set<string>();
    for (const c of claims) videoIds.add(c.videoId);

    let withDirectTruth = 0;
    let denies = 0;
    let withDeps = 0;
    let contradictsTotal = 0;
    let contradictsTyped = 0;

    const evidenceLengths: number[] = [];

    for (const c of claims) {
      if (c.directTruth !== undefined) withDirectTruth++;
      if (c.hostStance === "denies") denies++;
      if ((c.dependencies ?? []).length > 0) withDeps++;
      for (const d of c.dependencies ?? []) {
        if (d.kind === "contradicts") {
          contradictsTotal++;
          if (parseContradictsSubkind(d.rationale)) contradictsTyped++;
        }
      }
      for (const ev of c.evidence ?? []) {
        if (typeof ev.quote === "string") evidenceLengths.push(ev.quote.length);
      }
    }
    evidenceLengths.sort((a, b) => a - b);

    const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 10000) / 100);

    return [
      { section: "claims", name: "claims.total", value: total, unit: "count",
        description: "claims across every data/claims/<id>.json",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.avgPerVideo",
        value: Math.round((total / videoIds.size) * 100) / 100,
        unit: "count",
        description: "avg claims per video",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.directTruthPct",
        value: pct(withDirectTruth, total), unit: "pct",
        description: "share of claims with directTruth set (target: ≤80%)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.deniesPct",
        value: pct(denies, total), unit: "pct",
        description: "share of claims with hostStance='denies' (target: ≥5%)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.dependencyCoveragePct",
        value: pct(withDeps, total), unit: "pct",
        description: "share of claims with ≥1 dependency (target: ≥55%)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.evidenceP50Chars",
        value: percentile(evidenceLengths, 0.5), unit: "chars",
        description: "median evidence quote length (target: ≤150)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.evidenceP90Chars",
        value: percentile(evidenceLengths, 0.9), unit: "chars",
        description: "p90 evidence quote length (target: ≤450)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.evidenceMaxChars",
        value: evidenceLengths[evidenceLengths.length - 1] ?? 0, unit: "chars",
        description: "max evidence quote length (target: ≤800)",
        source: "data/claims/*.json" },
      { section: "claims", name: "claims.contradictsSubkindPct",
        value: contradictsTotal === 0 ? 100 : pct(contradictsTyped, contradictsTotal),
        unit: "pct",
        description: "share of contradicts deps whose rationale carries a typed prefix (target: ≥95%)",
        source: "data/claims/*.json" },
    ];
  },
};
