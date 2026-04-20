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
