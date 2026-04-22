# ai/reasoning — reasoning-layer driver + embeddings populator

Scripted drivers for the reasoning layer. The core modules are pure
TypeScript under [src/truth/](../../truth/) —
`claim-propagation.ts`, `claim-contradictions.ts`,
`claim-counterfactual.ts`, `contradicts-subkind.ts`. These `.mjs`
scripts drive those modules against a slice of the corpus so
operators can eyeball the output, and populate the
sentence-embedding cache the cross-video contradiction detector
consumes.

Unlike the sibling `ai/claims/` / `ai/entity-audit/` /
`ai/contradiction-verify/` directories, the reasoning computation is
pure code. The only AI call in this folder is to the local
sentence-transformer sidecar via `embed-claims.mjs`.

## Scripts

| Script | Purpose |
|---|---|
| `pick-videos.mjs [--count N] [--all] [--video <id>]…` | Pick N random / all / pinned videos that have `data/claims/<id>.json`. Writes `_reasoning_tmp/picks.json`. Skips corpus-derivative files (`claims-index`, `dependency-graph`, `contradictions`, `edge-truth`, `embeddings`, `consonance`, `contradiction-verdicts`). |
| `run.mjs [--out <dir>]` | Load the picked claim files, optionally consume an embeddings cache, run propagation + contradictions, write reports to `--out` (default `_reasoning_tmp/`). |
| `summary.mjs [--out <dir>]` | Human-readable summary of the latest run. |
| `embed-claims.mjs [--video <id>]… [--model <id>] [--dry]` | Compute sentence embeddings for every (or a pinned slice of) claim in `data/claims/*.json`; write to `data/claims/embeddings.json`. Idempotent — cache hits are free. |

`_reasoning_tmp/` is gitignored scratch. The embeddings cache in
`data/claims/embeddings.json` is also gitignored (~24 MB, regenerable
in seconds from the sidecar).

## Build dependency

The scripts import compiled JS from `dist/truth/` and
`dist/shared/embedding-bridge.js`. Run `npm run build` once after
editing anything in `src/truth/`, `src/claims/`, or
`src/shared/embedding-bridge.ts`.

## Ad-hoc invocation (sample or full-corpus)

```
npm run build
node src/ai/reasoning/pick-videos.mjs --count 2
node src/ai/reasoning/embed-claims.mjs   # optional; skip to force Jaccard path
node src/ai/reasoning/run.mjs
node src/ai/reasoning/summary.mjs
```

Or full-corpus mode:

```
node src/ai/reasoning/pick-videos.mjs --all
node src/ai/reasoning/run.mjs --out data/claims
node src/ai/reasoning/summary.mjs --out data/claims
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

`run.mjs` does **not** write `consonance.json` — that's an exclusive
of the `claim-indexes` pipeline stage. If consonance matters, use
`npx captions pipeline --stage claim-indexes` instead of (or after)
`run.mjs`.

`_reasoning_tmp/picks.json` is the input manifest written by
`pick-videos.mjs` and read by `run.mjs` / `summary.mjs` regardless
of `--out`. Per-phase timings print to stdout; no separate timings
file. Counterfactual queries are on-demand — import
[src/truth/claim-counterfactual.ts](../../truth/claim-counterfactual.ts)
from whatever caller needs them.

## Relationship to the `claim-indexes` pipeline stage

The preferred production path is `npx captions pipeline --stage claim-indexes`.
That stage reads the embeddings cache, loads the AI verdict cache, and
writes all five corpus files (including `consonance.json`). This
`run.mjs` driver is useful when the operator wants to force a specific
slice of videos, or debug the reasoning layer without touching the
committed corpus.
