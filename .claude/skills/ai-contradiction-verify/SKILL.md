---
name: ai-contradiction-verify
description: Run the contradiction verification pass — embed claims, run reasoning with cosine similarity, shard candidates across parallel agents, verdict each pair, apply verdicts. Use when the user asks to "verify contradictions", "clean up the contradictions", "re-run contradiction verification", or after new claim files land (re-extraction, new video ingest).
version: v1
lastVerifiedAgainstCorpus: 2026-04-24
---

# AI contradiction verify

Filters out false-positive
contradiction candidates by asking an AI verdict per pair.
Post-plan3 surface:
LOGICAL-CONTRADICTION / DEBUNKS / UNDERCUTS / ALTERNATIVE verdicts
all surface on `/contradictions` with their verdict label so the UI
can tier them (LOGICAL > DEBUNKS > ALTERNATIVE > UNDERCUTS);
COMPLEMENTARY / IRRELEVANT drop from the public view (the propagation
DAG still honors their coupling); SAME-CLAIM pairs become cross-video
agreements in `data/claims/consonance.json`.

This is an **AI session**, sharded across N parallel agents. Helper
scripts live in [src/ai/contradiction-verify/](../../../src/ai/contradiction-verify/).

## When to run

- After any v2 claim re-extraction batch (claim text changes
  → verdict cache invalidated for affected pairs).
- After new videos are added and reasoning runs.
- When the operator wants to manually trigger a fresh pass — dismissed
  verdicts (set `by: "operator"`) are preserved across runs.

## Steps

Do NOT parallelize the embedding or apply steps — only the per-shard
verification. The pipeline is:

### 1. Ensure `dist/` is fresh

```
npm run build
```

Skip if `dist/shared/embedding-bridge.js` is newer than
`src/shared/embedding-bridge.ts`.

### 2. Populate embeddings cache (if stale)

```
node src/ai/reasoning/embed-claims.mjs
```

Writes `data/claims/embeddings.json` (24 MB, gitignored). Idempotent —
re-running only embeds newly-changed claims. Needs
`sentence-transformers` installed (`pip install -r tools/requirements.txt`);
if missing, the whole chain falls back to Jaccard and this step can
be skipped.

### 3. Regenerate reasoning derivatives

```
node src/ai/reasoning/pick-videos.mjs --all
node src/ai/reasoning/run.mjs --out data/claims
```

Produces `claims-index.json`, `dependency-graph.json`, and an updated
`contradictions.json` where every cross-video pair has
`matchReason: "cosine"` and `verified: null`.

### 4. Shard the candidate pool

```
node src/ai/contradiction-verify/prepare.mjs --agents 8
```

Or with fewer agents for small pools:
```
node src/ai/contradiction-verify/prepare.mjs --agents 4
```

Or with `--skip-verified` to re-verify only new pairs since the last
run:
```
node src/ai/contradiction-verify/prepare.mjs --agents 8 --skip-verified
```

Writes `_contradiction_verify_tmp/slice-<i>.json` per agent, each
containing hydrated candidates (text, stance, evidence quote, shared
entities). Broken-presupposition contradictions are excluded from
verification — they're mechanically derived and don't need AI review.

### 5. Launch N parallel verification agents

One agent per slice. Each agent reads its `slice-N.json`, verdicts
every candidate, writes `slice-N.verdicts.json`. The per-agent prompt
must include the verdict taxonomy below and require one verdict per
candidate.

#### Verdict taxonomy

- **LOGICAL-CONTRADICTION** — strictly cannot both be true
- **DEBUNKS** — one claim presents evidence the other is false
- **UNDERCUTS** — reduces probative value, both can be partially true
- **ALTERNATIVE** — competing primary explanations for the same phenomenon
- **COMPLEMENTARY** — different aspects of a shared topic, no conflict
- **IRRELEVANT** — only generic shared entities (CIA, government…); different subjects
- **SAME-CLAIM** — same thesis in two different videos; cross-video agreement

#### Per-agent prompt template

```
You are agent <i> of <N> verifying contradiction candidates from
the verification pass.

## Input
`e:\github2\captions\_contradiction_verify_tmp\slice-<i>.json`

Each candidate has:
- `id`, `kind`, `subkind`, `matchReason`, `similarity`, `sharedEntities`
- `left` / `right` — each with: `id`, `videoId`, `text`, `hostStance`,
  `kind`, `directTruth`, `rationale`, `evidenceQuote`

## Output
Write `e:\github2\captions\_contradiction_verify_tmp\slice-<i>.verdicts.json`:

```
{
  "schemaVersion": 1,
  "generatedAt": "<ISO>",
  "agent": "claude-opus-4-7",
  "count": <N>,
  "verdicts": [
    { "left": "<id>", "right": "<id>", "verdict": "<ONE_OF>", "reasoning": "one short sentence" }
  ]
}
```

[verdict taxonomy above]

## Procedure
1. Read both `text` fields.
2. Ground in `evidenceQuote` + `rationale`.
3. Check `hostStance` (asserts↔denies flip is strong but not decisive).
4. Generic shared entities (CIA, government, military, scientists)
   alone → default IRRELEVANT unless the texts clearly address the
   same subject.
5. Prefer UNDERCUTS / ALTERNATIVE when both can be partially true;
   LOGICAL / DEBUNKS for strict contradictions only.

## Reasoning field
One concrete sentence naming what the claims disagree on or share.

## Constraints
- Read + Write only. No Bash, no Edit.
- Every candidate gets exactly one verdict.
- `left`/`right` in output match input EXACTLY (don't re-sort).

## Report back
`{ agent: <i>, total: N, byVerdict: {…}, durationSec: N }`
```

### 6. Apply verdicts

After all shards have written their `*.verdicts.json`:

```
node src/ai/contradiction-verify/apply.mjs
```

This:
- Merges all shard verdicts into `data/claims/contradiction-verdicts.json`
  (the persistent cache — preserved across runs, operator overrides
  via `by: "operator"` win).
- Rewrites `data/claims/contradictions.json` so LOGICAL-CONTRADICTION
  / DEBUNKS / UNDERCUTS / ALTERNATIVE verdicts surface with their
  verdict label (plus broken-presupposition, which wasn't verified).
  COMPLEMENTARY / IRRELEVANT drop from the public view.
- Writes `data/claims/consonance.json` with SAME-CLAIM pairs as
  cross-video agreements. Plan3 gates: SAME-CLAIM pairs with opposed
  `hostStance` are rejected; per-video pair count capped at 4 to
  avoid a single video dominating the feed.

### 7. Report

Summarize back:
- Total candidates verified
- Verdict distribution
- Before/after contradiction count
- Any pairs that remained `verified: null` (apply.mjs preserves them
  with a pending flag so the admin UI can show them)

## Quality bar

The verifier is the quality gate. The generator casts a wide net
(cosine ≥ 0.55) and the AI verdict filters it down. Aim for:
- ≥ 80% of final surfaced contradictions pass operator spot-check
- SAME-CLAIM and IRRELEVANT together should be the largest buckets
  (these are the false-positives the verifier was designed to catch)
- LOGICAL + DEBUNKS + UNDERCUTS + ALTERNATIVE combined (the surfaced
  set, post-plan3) should be 15-30% of the candidate pool — more
  means the generator is too tight; less means too loose. Note:
  UNDERCUTS + ALTERNATIVE are lower-tier signals; the UI should sort
  them below LOGICAL + DEBUNKS.

## Invariants

- **Never mutate per-video claim files.** All writes are to
  `data/claims/{contradictions,contradiction-verdicts,consonance}.json`.
- **Operator verdicts outrank AI verdicts.** An entry in
  `contradiction-verdicts.json` with `by: "operator"` must survive
  AI re-runs; apply.mjs preserves them.
- **Broken-presupposition stays mechanical.** The detector
  generates these from the typed `presupposes` edges; they don't go
  through the verifier because there's no subjective call to make.

## When to stop

If > 30% of verdicts are IRRELEVANT, the cosine threshold
(`crossVideoCosineMin` in `config/models.json`) is too permissive —
tune it up and re-run reasoning. If < 2% are LOGICAL / DEBUNKS, the
threshold is too tight — lower it and expect more noise to filter.

## Parallelism

130 candidates × 8 agents × ~75 s per shard = ~1.5 min wall for a
fresh run. Tokens: ~45–50k per agent, ~400k total. Cost: negligible.
Each additional agent shard amortizes the per-agent overhead (bundle
load, output write); beyond ~12 agents the speedup flattens.
