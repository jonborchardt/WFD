# src/ai/curate — heuristic alias curation

Pure-Node ESM scripts that propose bulk alias actions over the whole
corpus. They read `data/entities/<id>.json`, `data/transcripts/<id>.json`,
and the current `data/aliases.json`; they write new entries to
`data/aliases.json` via the typed mutators in
[src/graph/aliases-schema.ts](../../graph/aliases-schema.ts). Driven by
the [ai-alias-curation](../../../.claude/skills/ai-alias-curation/SKILL.md)
skill; see [CLAUDE.md § AI alias curation](../../../CLAUDE.md) for the
full operator playbook.

This folder also contains [delete-always.ts](delete-always.ts) —
committed `DELETE_ALWAYS` / `ALWAYS_PROMOTE` / `DELETE_LABELS` lists
that the indexes pipeline stage auto-applies on every rebuild (role
nouns, transcript artifacts, tautologies, famous-name short forms,
whole label classes that are never graph-worthy).

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

This is a scripted, heuristic-driven curator. It does NOT replace human
judgment — the tradeoff is coverage (runs on 200+ videos in seconds) vs.
precision (some calls will be wrong). Every write is reversible via the
⋯ action menu on `/admin/aliases` or by restoring the `.before.json`
backup. Deeper, context-aware resolution happens in the sibling
[`../entity-audit/`](../entity-audit/) and
[`../entity-resolution/`](../entity-resolution/) passes.

When adding new videos to the corpus, re-run the pipeline to pick up merges
on the new transcripts. The scripts are idempotent — already-applied entries
are skipped.
