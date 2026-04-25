// Plan 05 — metrics module types.
//
// Every corpus-quality signal the quality program cares about
// surfaces as a Metric record. Sections group related metrics
// (entity-hygiene, claims, contradictions, …). The CLI
// (`npm run metrics` / `metrics:baseline` / `metrics:check`) composes
// every section's compute() into one snapshot, then compares against
// targets (upper / lower bounds) and baseline (regression gate).
//
// Pure data — no I/O lives in this file. Sections do their own reads.

export type MetricUnit = "count" | "pct" | "chars" | "seconds" | "bool";

export interface Metric {
  /** Dot-separated canonical name — "claims.deniesPct". Stable across runs. */
  name: string;
  /** Current value. null = cannot be computed this run (e.g. file missing). */
  value: number | null;
  unit?: MetricUnit;
  /** Short human description — surfaced in CLI + dashboard. */
  description?: string;
  /** Which section owns this metric. Used for grouping in the UI. */
  section: string;
  /** File path or description of where this metric was sourced. */
  source?: string;
}

export interface MetricsSnapshot {
  generatedAt: string;
  metrics: Metric[];
}

export interface MetricTarget {
  /** Metric name this target applies to. Must match a Metric.name. */
  name: string;
  /** Floor — gate fails when current < min. Hard regression boundary. */
  min?: number;
  /** Ceiling — gate fails when current > max. Hard regression boundary. */
  max?: number;
  /**
   * Aspirational floor — gate DOES NOT fail when current < targetMin, but
   * the dashboard surfaces the distance-to-target so the team can see
   * they're below where they want to be. Use alongside `min` (hard floor)
   * when the current corpus can't meet the aspiration yet but the team
   * wants to track progress toward it.
   */
  targetMin?: number;
  /** Aspirational ceiling — same semantics as targetMin, for upper-bounded metrics. */
  targetMax?: number;
  /** Optional unit hint, displayed next to the bound. */
  unit?: MetricUnit;
  /** Optional note explaining the target. */
  note?: string;
}

export interface MetricsTargetsFile {
  schemaVersion: 1;
  targets: MetricTarget[];
}

export interface MetricsBaselineFile {
  schemaVersion: 1;
  /** ISO timestamp of the baseline capture. */
  capturedAt: string;
  /** Git commit at capture time, when available. */
  commit?: string;
  metrics: Record<string, number | null>;
}

// A MetricSection is what each compute-file exports. The registry
// composes them — see `src/metrics/index.ts`.
export interface MetricSection {
  section: string;
  /** Pure-ish: reads disk, returns metric array. No side-effects beyond reads. */
  compute(dataDir: string): Promise<Metric[]> | Metric[];
}

// --- Gate result (used by the regression check) --------------------

export type GateStatus = "ok" | "regressed" | "improved" | "new" | "missing";

export interface GateRow {
  name: string;
  current: number | null;
  baseline: number | null;
  target?: MetricTarget;
  status: GateStatus;
  /** When status !== "ok", why. */
  reason?: string;
  /**
   * True iff an aspirational `targetMin`/`targetMax` bound is breached.
   * The gate itself stays "ok" (no failure) — this is an info-level
   * signal the dashboard renders as "distance to target".
   */
  targetWarning?: string;
}

export interface GateReport {
  ok: boolean;
  rows: GateRow[];
  /** Subset of rows with status === "regressed". */
  regressions: GateRow[];
  checkedAt: string;
}
