---
name: metrics
description: Compute + check + baseline the corpus-quality metrics. Use when the user asks to "run metrics", "check metrics", "capture baseline", "show the dashboard numbers", "gate on metrics", "did we regress", or any time the operator wants to see the entity-hygiene / claims / contradictions / corrections signals in one place.
---

# Metrics

Runs the metrics module at [src/metrics/](../../../src/metrics/) — 47
quality signals across 5 sections: entity-hygiene, entity-resolution,
claims, contradictions, operator-corrections. Three modes:

- **Print** — human-readable snapshot. `npm run metrics`
- **Baseline** — freeze current as the reference point for the gate.
  `npm run metrics:baseline`
- **Check** — compare current vs baseline + targets, exit non-zero on
  regression. `npm run metrics:check`

Targets live at `config/metrics-targets.json`. Baseline at
`config/metrics-baseline.json`. Per-day snapshots in
`data/metrics/history/<day>.json`.

## When to invoke

- Operator asks "are we good?" / "where did quality go?" / "show me
  the numbers"
- Before a commit or PR that touched the quality pipeline — run
  `npm run metrics:check` to guard against accidental regression
- After a new batch of video ingest, v2 claim re-extraction, or Plan
  04 verification — capture a new baseline so the gate is calibrated
  to the new reality
- When investigating a `npm run test:ci` failure (the CI target
  chains `metrics:check` after vitest)

## Steps

### Print (default)

```
npm run metrics                    # grouped text dashboard
npm run metrics -- --json          # raw JSON
npm run metrics -- --markdown      # markdown table, useful for PR bodies
```

Relay highlights to the user:
- Total metrics + gate status
- Any section with regressions (name + current vs baseline)
- Any section with improvements worth celebrating (dependency
  coverage ↑, evidence length ↓, denies %↑)

### Baseline (when promoting a new reality)

```
npm run metrics:baseline
```

Captures current snapshot → `config/metrics-baseline.json` and
`data/metrics/history/<YYYY-MM-DD>.json`. Commit both so future
gate runs can compare against this point.

Ask before baselining if:
- Recent work reduced any HIGHER_IS_BETTER metric. Operator may
  want to investigate before promoting.
- Any target is still breached. Baseline doesn't fix that —
  targets are absolute.

### Check (gate)

```
npm run metrics:check
```

Exit 0 = ok. Exit 1 = regression. Both stdout + stderr describe
what moved.

## Targets — when to edit them

`config/metrics-targets.json` encodes aspirational bounds. Edit when:

- Plans ship a new quality floor (v2 claim `claims.deniesPct ≥ 5%`)
- Operator decides a previously-soft regression is acceptable
  (corpus growth made a metric drift naturally)
- A metric was mis-calibrated at initial land (too permissive or too
  tight)

Any target edit should land in the same commit as its rationale.

## Calibration bundle (F2)

Feeds operator-confirmed signal into future AI sessions as few-shot
context:

```
node src/ai/calibration/bundle.mjs
```

Writes `_calibration_tmp/examples.json`. Downstream AI skills
(ai-entity-audit, ai-contradiction-verify) can read this for
context injection. Not a training pipeline — just few-shot examples.

## Gold sample (F3)

The gold slice is 20 videos the operator has manually verified as
correct. Regressions on any gold video are a stronger smoke test
than corpus-wide averages.

```
node src/ai/calibration/gold-seed.mjs            # snapshot current claims as gold
node src/ai/calibration/gold-seed.mjs --video <id> [--video <id>]  # pin specific videos
node src/ai/calibration/gold-check.mjs           # diff current vs gold, exit 1 on material regression
```

Run gold-check alongside metrics:check when doing a serious quality
audit. Re-seed gold when the operator has hand-verified a fresh slice
and wants to freeze it.

## Dashboard UI

`/admin/metrics` (only in dev / admin builds) hits `/api/metrics`
for a live snapshot + gate report. Color-coded grid by section,
shows current / baseline / target / reason per metric.

## Invariants

- **Metrics are read-only.** Compute reads disk, never writes
  corpus state. The only writes are to the committed config files
  (targets/baseline) and `_calibration_tmp/`.
- **Targets are code-level decisions.** Edits to
  `metrics-targets.json` require PR review like any other config.
- **Baseline drift is NOT a regression by itself.** Only
  direction-aware drift fails — `entities.active` going up or down
  is information, not a failure.
- **Info-only metrics (`embeddings.dimensions`, `claims.total`)**
  get `status: "new"` on drift instead of "regressed" so the gate
  stays focused on quality signals.
