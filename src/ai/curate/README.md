# src/ai/curate — AI alias curation helpers

Pure-Node ESM scripts that implement Plan 1 (`plans/01-ai-alias-curation.md`).
They read `data/entities/<id>.json`, `data/transcripts/<id>.json`, and the
current `data/aliases.json`; they write new entries to `data/aliases.json`
via the typed mutators in [src/graph/aliases-schema.ts](../../graph/aliases-schema.ts).

Each script is a single `node` invocation — no build step, no sidecars.

## Pipeline

```
node src/ai/curate/build-corpus.mjs
node src/ai/curate/propose.mjs           # writes _curate_tmp/proposals.json
node src/ai/curate/apply.mjs             # validates + applies (backup first)
npx captions pipeline --stage indexes    # rebuild indexes
```

Each run emits timing + counts. `_curate_tmp/aliases.before.json` is created
by `apply.mjs` so you can revert with one `cp`.

## Heuristics

**videoMerges** — short canonical X → long canonical Y, same video, same label, iff
- label ∈ {person, organization, work_of_media, event, facility, technology}
- X.tokens is a proper contiguous subsequence of Y.tokens
- Y.tokens[0] !== "the" (don't merge clean form into a "the X" form)
- no X-token shorter than 3 chars (guards NER fragments like "al", "ro")
- if X is a single token, that token is not in the common-noun blocklist
  (`government`, `military`, `man`, `earth`, `moon`, …)
- Y has ≥ 2 mentions in this video
- exactly one such Y exists in this video (unambiguous)
- X and Y are not already `notSame`
- X is not already merged or deleted at corpus level
- X is not already videoMerged in this video

**the-prefix merges** — `L:the X` → `L:X` when `L:X` also exists in the corpus
(collapses determiner variants; corpus-wide merge, not per-video).

**deletedEntities** — canonicals containing `[music]` as a substring
(transcript-marker pollution).

## Context for Claude Code sessions

This is a scripted, heuristic-driven implementation of Plan 1. It does NOT
replace human judgment — the tradeoff is coverage (runs on 217+ videos in
seconds) vs. precision (some calls will be wrong). Every write is reversible
via the ⋯ action menu on `/admin/aliases` or by restoring the `.before.json`
backup.

When adding new videos to the corpus, re-run the pipeline to pick up merges
on the new transcripts. The scripts are idempotent — already-applied entries
are skipped.
