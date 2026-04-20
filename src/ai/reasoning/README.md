# ai/reasoning — Plan 3 test harness

Scripted drivers for the reasoning layer described in
[plans/03-reasoning-layer.md](../../../plans/03-reasoning-layer.md). The
core modules are pure TypeScript under
[src/truth/](../../truth/) — `claim-propagation.ts`,
`claim-contradictions.ts`, `claim-counterfactual.ts`. These `.mjs` scripts
exist only to drive those modules against a small slice of the corpus so
operators can eyeball the output before rolling the reasoning layer out to
every video.

Unlike the sibling `ai/claims/` and `ai/curate/` directories, there is no
AI session here. Plan 3 is pure code. The scripts just sequence the three
modules and write their output to a scratch dir.

## Scripts

| Script | Purpose |
|---|---|
| `pick-videos.mjs [--count N] [--video <id>]…` | Pick N random videos that already have `data/claims/<id>.json`. Writes `_reasoning_tmp/picks.json`. |
| `run.mjs` | Load the picked claim files, run propagation + contradictions + counterfactual, write reports + timings to `_reasoning_tmp/`. |
| `summary.mjs` | Print a human-readable summary of the run. |

`_reasoning_tmp/` is gitignored scratch. Delete freely between runs.

## Build dependency

The scripts import compiled JS from `dist/truth/`. Run `npm run build` once
after editing anything in `src/truth/` or `src/claims/`.

## Invocation

```
npm run build
node src/ai/reasoning/pick-videos.mjs --count 2
node src/ai/reasoning/run.mjs
node src/ai/reasoning/summary.mjs
```

The [ai-reasoning-layer](../../../.claude/skills/ai-reasoning-layer/SKILL.md)
skill wraps this flow for Claude Code invocation.

## Outputs

`run.mjs` writes three files to `--out <dir>` (default `_reasoning_tmp/`):

```
claims-index.json       flat list of claims with derivedTruth + propagation meta
dependency-graph.json   DAG edges (from, to, kind, rationale)
contradictions.json     pair / broken-presup / cross-video conflicts (total + byKind + list)
```

`_reasoning_tmp/picks.json` is the input manifest written by
`pick-videos.mjs` and read by `run.mjs` / `summary.mjs` regardless of
`--out`. Per-phase timings print to stdout; no separate timings file.
Counterfactual queries are on-demand (Plan 3 §API) — import
[src/truth/claim-counterfactual.ts](../../truth/claim-counterfactual.ts)
from whatever caller needs them.

## Promoting to a pipeline stage

Once full-corpus output (`run.mjs --out data/claims`) passes review,
wire the three modules into a new `claim-indexes` graph stage in
[src/pipeline/stages.ts](../../pipeline/stages.ts). The per-video
loader in `run.mjs` is the reference implementation to copy.
