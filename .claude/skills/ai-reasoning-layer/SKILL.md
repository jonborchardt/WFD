---
name: ai-reasoning-layer
description: Run the reasoning-layer test harness. Use when the user asks to "run reasoning", "try the reasoning layer", "compute derived truth", "find contradictions", or any time the reasoning modules (claim-propagation / claim-contradictions / claim-counterfactual) need to be exercised against a slice of the corpus.
---

# AI reasoning layer

Drives the the reasoning layer modules under [src/truth/](../../../src/truth/) —
`claim-propagation`, `claim-contradictions`, (and `claim-counterfactual`
for on-demand queries) — against a slice of videos that already have
claim files. Unlike `ai-claims-extraction`, there is **no AI session**
here: the reasoning layer is pure code. Your job is to sequence the scripts, report
timings, and surface anything surprising in the output so the user can
decide whether to roll the reasoning layer out to the full corpus.

Helper scripts live in [src/ai/reasoning/](../../../src/ai/reasoning/).

## Two modes

The skill runs in one of two modes based on the user's phrasing:

- **Sample mode** — "run plan 3 on 2 random videos", "try it on a few
  videos", "show me what this looks like". Picks a small slice, runs,
  reports picks back to the user first so they can abort if a pick is
  unsuitable.
- **Full-corpus mode** — "run it for all videos", "do it for real",
  "promote it". No approval gate, no sampling — every video with a
  claim file is included. Proceed straight through all steps.

If the user's phrasing is ambiguous (just "run the reasoning layer"),
default to sample mode with `--count 2`.

## Steps

### 1. Ensure `dist/` is fresh

```
npm run build
```

The `.mjs` scripts import from `dist/truth/`. Skip the rebuild if nothing
under `src/truth/` or `src/claims/` has changed since the last build.

### 2. Pick the batch

**Sample mode** — default 2 random videos that have `data/claims/<id>.json`:

```
node src/ai/reasoning/pick-videos.mjs --count 2
```

Pin specific ids if the user asked for them:

```
node src/ai/reasoning/pick-videos.mjs --video <id1> --video <id2>
```

Report the picks back to the user before proceeding to step 3 so they
can abort if a pick is unsuitable.

**Full-corpus mode** — every claim-having video, no approval gate:

```
node src/ai/reasoning/pick-videos.mjs --all
```

Proceed directly to step 3.

### 3. Run the pipeline

**Sample mode** — reports land in `_reasoning_tmp/` (gitignored scratch,
so the sample output doesn't pollute committed state):

```
node src/ai/reasoning/run.mjs
```

**Full-corpus mode** — reports land in `data/claims/` per the reasoning layer, so the
derived files sit next to the per-video claim files and become part of
the committed corpus:

```
node src/ai/reasoning/run.mjs --out data/claims
```

In either case, `run.mjs` sequences:

1. **load**              — read every `data/claims/<id>.json` for the picks
2. **propagation**       — `propagateClaims()` → derived truth per claim
3. **dependency graph**  — flatten the DAG into an edge list
4. **contradictions**    — pair + broken-presupposition + cross-video

Three output files (in `--out <dir>`):

- `claims-index.json` — flat list with `derivedTruth` per claim, plus
  propagation metadata (iterations, maxDelta) at the top level
- `dependency-graph.json` — DAG edges
- `contradictions.json` — report (includes `total` + `byKind` counts)

Per-phase timings print to stdout from `run.mjs`. Counterfactual queries
are on-demand (the reasoning layer §API additions), not a batch artifact — the module
[claim-counterfactual.ts](../../../src/truth/claim-counterfactual.ts) is
imported directly by whatever caller needs it.

Input claim files under `data/claims/<id>.json` are read-only — never
mutated, even in full-corpus mode. The three derived filenames
(`claims-index`, `dependency-graph`, `contradictions`) can't collide
with `<videoId>.json` because video ids never take those names.

### 4. Summarize

```
node src/ai/reasoning/summary.mjs                   # sample mode
node src/ai/reasoning/summary.mjs --out data/claims  # full-corpus mode
```

Prints a structured report: claim counts, kind/stance histograms,
iteration count, how many claims' derived truth moved materially, top
contradictions.

Relay to the user:

- **Timing** — total ms and per-phase breakdown from `run.mjs` stdout
  (this is what the user asked for; lead with it)
- **Scale** — N videos, M total claims, K claims had directTruth,
  L ended up with derivedTruth
- **Propagation** — iterations to convergence, top 5 claims whose
  derived truth moved > 0.05 away from the anchor (interesting signal —
  those are the claims dependency structure actually influences)
- **Contradictions** — count by kind, with summaries of up to 5 samples

### 5. Follow-up (sample mode only)

If the user approves the sample output, the natural next step is
full-corpus mode (`pick-videos.mjs --all`, then `run.mjs`). Once that
also looks good, promote the three modules into a real `claim-indexes`
graph stage in
[src/pipeline/stages.ts](../../../src/pipeline/stages.ts) that writes
to `data/claims/claims-index.json` et al. `run.mjs` is the reference
implementation to copy.

Full-corpus mode skips this step — nothing to follow up on.

## Invariants

- **Read-only against `data/`.** These scripts never mutate
  `data/claims/<id>.json` or anything else in `data/`. All output goes
  to `_reasoning_tmp/`. If you need to edit a claim file, that's a
  different skill (`ai-claims-extraction`).
- **No new claims.** The reasoning layer consumes claims; it does not
  produce them. If a picked video has no claim file, stop.
- **Intra-file dependencies only.** The claim validator enforces that
  every `dep.target` is a claim id within the same file. Propagation
  respects this; the DAG is a disjoint union of per-video subgraphs.
- **Cross-video contradictions are inferred, not declared.** They come
  from shared entity keys + opposite `hostStance` + token-Jaccard
  similarity on claim text. Version-1 heuristic only; embedding
  similarity is a later add.

## Quality bar for the report back to the user

- Lead with timing. That's what the user asked for.
- Flag anything surprising: a video with zero claims in the contradictions
  report, a counterfactual that moved zero claims (probably means
  dependency structure is too sparse), an iteration count that hit the
  max (suggests non-convergence).
- Don't dump raw JSON. Summarize. The user can open the files in
  `_reasoning_tmp/` themselves if they want the full payload.

## When to stop a session

If `run.mjs` throws, report the error and stop. Most likely causes:

- Picked video's claim file is corrupt (fix with `ai-claims-extraction`).
- Dependency target references a claim id not in the file (should have
  been caught by the claims validator — if not, that's a validator bug
  worth raising).
- Module import error — probably means `dist/truth/` is stale. Run
  `npm run build` and try again.
