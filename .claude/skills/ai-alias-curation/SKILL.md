---
name: ai-alias-curation
description: Run the heuristic AI alias-curation playbook. Use when the user asks to "curate aliases", "clean up entities", "run alias curation", "rebuild the graph with better merges", or any time new videos are added to the corpus and per-video short-name → full-name mappings need to be proposed again.
version: v1
lastVerifiedAgainstCorpus: 2026-04-24
---

# AI alias curation

Scripted, heuristic-driven implementation of
the heuristic alias proposer.
Runs over the whole corpus in seconds, proposes alias actions, applies them,
and rebuilds the graph indexes.

Do NOT run any of these steps in parallel — they are sequential. The
proposal step depends on the corpus map, and the apply step depends on the
proposal file.

## Steps

1. **Ensure `dist/` is fresh** (apply.mjs imports from `dist/graph/`).
   ```
   npm run build
   ```
   Skip if `dist/graph/aliases-schema.js` is newer than
   `src/graph/aliases-schema.ts`.

2. **Build the corpus entity map.**
   ```
   node src/ai/curate/build-corpus.mjs
   ```
   Writes `_curate_tmp/corpus.json`.

3. **Propose alias actions.**
   ```
   node src/ai/curate/propose.mjs
   ```
   Writes `_curate_tmp/proposals.json`. Reports counts by category.

4. **Inspect proposals** (report counts + a handful of examples to the user).
   Give the user a chance to abort before the actual writes. Focus on:
   - total videoMerges count + top pairs by frequency
   - total corpus-merges count + a few examples
   - proposed deletions (these affect all videos)

5. **Apply.**
   ```
   node src/ai/curate/apply.mjs
   ```
   Creates `_curate_tmp/aliases.before.json` on first run (one-shot
   backup). Subsequent runs reuse the same backup — delete it manually
   if you want to snapshot a later baseline.

6. **Rebuild indexes.**
   ```
   npx captions pipeline --stage indexes
   ```

7. **Report** the diff and timing summary to the user.
   Use `_curate_tmp/aliases.before.json` vs current `data/aliases.json`
   for the diff.

## Tuning the heuristic

All rules live in [src/ai/curate/propose.mjs](../../../src/ai/curate/propose.mjs):
- `ALLOWED_LABELS` — which entity labels participate in the short→long merge
- `COMMON_NOUN_BLOCKLIST` — single-token shorts that should NOT merge
  (government, military, earth, moon, year, …)
- The subsequence rule (`isSubseq`) — proper contiguous token subset
- Target filter: `y.toks[0] !== "the"` (never merge clean into "the X")

If the user reports false positives, add the offending token to the
blocklist and re-run. The apply script is idempotent — unchanged proposals
are skipped.

## Reverting

- Per entry via the ⋯ action menu at `/admin/aliases`
- Whole run via `cp _curate_tmp/aliases.before.json data/aliases.json`
  then `npx captions pipeline --stage indexes`

## Invariants

- AI never writes to `data/entities/<id>.json` or `data/relations/<id>.json`.
  All corrections flow through `data/aliases.json`.
- Respects `notSame` pairs. Never emits `notSame` or `dismissed` entries
  — those are operator cognition.
- `deletedRelations` belongs in the reasoning / admin flow, not this skill.
