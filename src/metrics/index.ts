// Registry + runner for Plan 05 metrics.
//
// computeAll() is the public entry. CLIs and API handlers import this
// one function, get a full snapshot, and render or persist as needed.
// Sections are plain objects — adding a new one is a 1-line import +
// push into the array below.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { entityHygieneSection } from "./entity-hygiene.js";
import { entityResolutionSection } from "./entity-resolution.js";
import { claimsSection } from "./claims.js";
import { contradictionsSection } from "./contradictions.js";
import { operatorCorrectionsSection } from "./operator-corrections.js";
import type {
  GateReport,
  GateRow,
  GateStatus,
  Metric,
  MetricSection,
  MetricsBaselineFile,
  MetricsSnapshot,
  MetricsTargetsFile,
} from "./types.js";

export const SECTIONS: MetricSection[] = [
  entityHygieneSection,
  entityResolutionSection,
  claimsSection,
  contradictionsSection,
  operatorCorrectionsSection,
];

export async function computeAll(dataDir: string): Promise<MetricsSnapshot> {
  const metrics: Metric[] = [];
  for (const section of SECTIONS) {
    const rows = await section.compute(dataDir);
    for (const r of rows) metrics.push(r);
  }
  return { generatedAt: new Date().toISOString(), metrics };
}

// ---- Targets + baseline IO -------------------------------------------

export function readTargetsFile(path: string): MetricsTargetsFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MetricsTargetsFile;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.targets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBaselineFile(path: string): MetricsBaselineFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MetricsBaselineFile;
    if (parsed.schemaVersion !== 1 || typeof parsed.metrics !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBaselineFile(
  path: string,
  snapshot: MetricsSnapshot,
  commit?: string,
): void {
  const metrics: Record<string, number | null> = {};
  for (const m of snapshot.metrics) metrics[m.name] = m.value;
  const file: MetricsBaselineFile = {
    schemaVersion: 1,
    capturedAt: snapshot.generatedAt,
    commit,
    metrics,
  };
  const dir = dirname(resolve(path));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

// ---- Gate -------------------------------------------------------------

export interface GateOptions {
  /** Allow current values that are strictly better than the baseline
   *  (more entities deleted, fewer role nouns, tighter evidence). Default true. */
  allowImprovements?: boolean;
  /** Tolerance percentage — a metric is only "regressed" if it drifts
   *  more than this fraction from baseline. Default 0.05 (5%). */
  tolerancePct?: number;
}

/**
 * Direction hint per metric: true = higher is better, false = lower is better,
 * undefined = no direction (info-only; always "ok"). Explicit rather than
 * heuristic because "entities.active" could go either way depending on
 * corpus growth.
 */
const HIGHER_IS_BETTER: Record<string, boolean> = {
  // entity-hygiene — deletion / merge counts should grow or hold.
  "entities.deleted": true,
  "entities.merged": true,
  "entities.perVideoMerged": true,
  "entities.deleteAlwaysListSize": true,
  // but role-noun / tautology counts should shrink.
  "entities.roleNounPersons": false,
  "entities.tautologies": false,
  // entity-resolution — ambiguity + case duplicates should shrink.
  "resolution.firstNamePersonsMultiVideo": false,
  "resolution.caseDuplicates": false,
  "resolution.gazetteerSize": true,
  "resolution.gazetteerActive": true,
  // claims — denies coverage + dep coverage + subkind coverage should grow;
  // evidence lengths should shrink; directTruth should trend down to ~60-80.
  "claims.deniesPct": true,
  "claims.dependencyCoveragePct": true,
  "claims.contradictsSubkindPct": true,
  "claims.evidenceP50Chars": false,
  "claims.evidenceP90Chars": false,
  "claims.evidenceMaxChars": false,
  // contradictions — consonance is a positive surface; pending-verify should shrink.
  "consonance.count": true,
  "contradictions.pendingVerify": false,
  "verdicts.total": true,
  "verdicts.operator": true,
  "embeddings.cached": true,
};

export function runGate(
  snapshot: MetricsSnapshot,
  targets: MetricsTargetsFile | null,
  baseline: MetricsBaselineFile | null,
  opts: GateOptions = {},
): GateReport {
  const tolerance = opts.tolerancePct ?? 0.05;
  const allowImprovements = opts.allowImprovements ?? true;
  const targetByName = new Map(
    (targets?.targets ?? []).map((t) => [t.name, t] as const),
  );
  const baseByName = baseline?.metrics ?? {};

  const rows: GateRow[] = [];
  for (const m of snapshot.metrics) {
    const target = targetByName.get(m.name);
    const base = Object.prototype.hasOwnProperty.call(baseByName, m.name)
      ? (baseByName[m.name] ?? null)
      : null;

    let status: GateStatus = "ok";
    let reason: string | undefined;
    let targetBreached = false;

    // Target-bound check first — these are absolute, baseline doesn't
    // rescue a target breach.
    if (target && m.value !== null) {
      if (target.max !== undefined && m.value > target.max) {
        status = "regressed";
        reason = `exceeds max ${target.max}${target.unit === "pct" ? "%" : ""}`;
        targetBreached = true;
      } else if (target.min !== undefined && m.value < target.min) {
        status = "regressed";
        reason = `below min ${target.min}${target.unit === "pct" ? "%" : ""}`;
        targetBreached = true;
      }
    }

    // Baseline drift check — only when we didn't already fail a target.
    if (status === "ok" && base !== null && m.value !== null) {
      const direction = HIGHER_IS_BETTER[m.name];
      const delta = m.value - base;
      const absDelta = Math.abs(delta);
      const scale = Math.max(1, Math.abs(base));
      const relDelta = absDelta / scale;

      if (direction === undefined) {
        // No direction — any large drift gets a soft "new" status so it
        // shows up in the dashboard but doesn't fail the gate.
        if (relDelta > tolerance) {
          status = "new";
          reason = `drift ${delta >= 0 ? "+" : ""}${delta} (info only)`;
        }
      } else {
        const worse =
          (direction === true && delta < 0) ||
          (direction === false && delta > 0);
        if (worse && relDelta > tolerance) {
          status = "regressed";
          reason = `${direction ? "dropped" : "grew"} by ${delta}`;
        } else if (!worse && relDelta > tolerance && allowImprovements) {
          status = "improved";
          reason = `${direction ? "grew" : "dropped"} by ${delta}`;
        }
      }
    } else if (base === null && m.value !== null && !targetBreached) {
      status = "new";
    } else if (base !== null && m.value === null) {
      status = "missing";
      reason = "baseline had a value, current run produced null";
    }

    rows.push({ name: m.name, current: m.value, baseline: base, target, status, reason });
  }

  const regressions = rows.filter((r) => r.status === "regressed");
  return {
    ok: regressions.length === 0,
    rows,
    regressions,
    checkedAt: new Date().toISOString(),
  };
}

export type { Metric, MetricSection, MetricsSnapshot } from "./types.js";
