# ai

Claude-Code-driven enrichment pass that runs **after** the NLP pass. Refines
existing relationships and surfaces ones the NLP layer missed. Batch pass
invoked via Claude Code, not a runtime API call.

Status: not implemented.

## curate/ — AI alias curation (Plan 1)

Scripted implementation of [plans/01-ai-alias-curation.md](../../plans/01-ai-alias-curation.md).
Scans every `data/entities/<id>.json` + the corpus, proposes alias actions
(short→long videoMerges, `the X` → `X` corpus merges, `[music]` artifact
deletions), and applies them via the typed mutators in
[src/graph/aliases-schema.ts](../graph/aliases-schema.ts).

```
node src/ai/curate/build-corpus.mjs    # ~500ms
node src/ai/curate/propose.mjs         # ~600ms, writes _curate_tmp/proposals.json
node src/ai/curate/apply.mjs           # backs up + applies, bumps graph.dirtyAt
npx captions pipeline --stage indexes  # rebuild
```

Invoke from Claude Code via the [ai-alias-curation](../../.claude/skills/ai-alias-curation/SKILL.md)
skill — it runs the whole flow and reports a diff. Heuristic + blocklist
live in [propose.mjs](curate/propose.mjs). See [curate/README.md](curate/README.md)
for tuning guidance.

Re-run whenever new videos are added. Apply is idempotent — already-handled
entries are skipped.

## claims/ — AI claim extraction (Plan 2 Part 2)

Scripted scaffolding for the per-video claim-extraction session described
in [plans/02-claims-module.md](../../plans/02-claims-module.md). Mirrors
the shape of `curate/` — Claude does the thinking (reading transcripts,
deciding what counts as a thesis-level claim, attaching evidence), the
`.mjs` scripts handle plumbing (picking videos, packaging input bundles,
post-write validation, batch summary).

```
node src/ai/claims/pick-videos.mjs --count 20    # picks N from videos without claim files
node src/ai/claims/prepare.mjs <videoId>         # writes _claims_tmp/<id>.input.json
# Claude reads the bundle, writes data/claims/<id>.json directly via Write
node src/ai/claims/validate.mjs <videoId>        # gates each write
node src/ai/claims/summary.mjs                   # batch summary + timings
```

Invoke from Claude Code via the [ai-claims-extraction](../../.claude/skills/ai-claims-extraction/SKILL.md)
skill — it runs the per-video loop end-to-end and parallelizes
trivially across general-purpose subagents (one chunk of videos per
agent). See [claims/README.md](claims/README.md) for the script
contracts and the schema lives in [src/claims/](../claims/).

Resumability is automatic — `pick-videos.mjs` filters out videos that
already have a claim file, so a killed session re-picks only the gaps
on the next invocation. Atomic writes via temp+rename mean a partial
write can never produce a corrupt file.
