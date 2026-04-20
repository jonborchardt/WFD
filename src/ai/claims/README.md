# ai/claims — Plan-2 Part-2 helper scripts

Scripted scaffolding for the AI claim-extraction session described in
[plans/02-claims-module.md](../../../plans/02-claims-module.md). Mirrors the
shape of [`src/ai/curate/`](../curate/): tiny `.mjs` scripts driven by Claude
Code through the [ai-claims-extraction](../../../.claude/skills/ai-claims-extraction/SKILL.md)
skill.

The AI does the *thinking* (reading transcripts, deciding what counts as a
claim, attaching evidence). These scripts handle the *plumbing* — picking
videos, packaging the input bundle Claude reads, and post-write validation.

## Scripts

| Script | Purpose |
|---|---|
| `pick-videos.mjs [--count N] [--video <id>]…` | List N random videos that have entities + relations but no claim file yet. Or pin specific ids. Writes `_claims_tmp/picks.json`. |
| `prepare.mjs <videoId>` | Dump the AI input bundle for one video (flattened transcript + entity keys + relation edges) to `_claims_tmp/<id>.input.json`. |
| `validate.mjs <videoId>` | Validate `data/claims/<id>.json` against transcript / entities / relations. Reports errors or `ok`. |
| `summary.mjs` | After a batch, print per-video claim counts, kind histogram, validation status, and total elapsed time. Reads `_claims_tmp/picks.json` for scope and `_claims_tmp/timings.json` for per-video timings. |

`_claims_tmp/` is gitignored scratch — safe to delete between sessions.

## Build dependency

Scripts import compiled output from `dist/claims/`. Run `npm run build` once
after editing `src/claims/*.ts` before invoking the scripts.

## Invocation flow

The skill orchestrates the order:

```
npm run build                            # if src/claims/ changed
node src/ai/claims/pick-videos.mjs --count 2
# for each picked video:
node src/ai/claims/prepare.mjs <id>      # writes _claims_tmp/<id>.input.json
# Claude reads the input bundle, writes data/claims/<id>.json directly
node src/ai/claims/validate.mjs <id>     # passes or surfaces errors to fix
node src/ai/claims/summary.mjs           # final report + timing
```

No `apply.mjs` step — claim files are written in place during the session,
not staged. The downstream `claim-indexes` graph stage (deferred to a
follow-up commit) will pick them up via `graph.dirtyAt`.
