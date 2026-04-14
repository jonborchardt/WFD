# cli

`captions` command-line entrypoint. Drives the whole pipeline from the
terminal. This is the canonical way to add a video and push it through
fetch → NLP → AI enrichment → per-claim truthiness → graph propagation →
contradictions → novel-link detection.

## Commands

```
captions add <url-or-id>                           seed a row in the catalog
captions pipeline [--video <id>] [--stage <name>]  run stale stages
                  [--dry-run]
captions audit                                     state summary
captions status [--video <id>]                     per-row stage map
captions catalog sync-meta                         backfill catalog from on-disk transcript meta
```

## catalog sync-meta

Walks every catalog row, opens its `transcriptPath`, and copies any fields
present in the transcript's `meta` block (title, channel, description,
keywords, viewCount, lengthSeconds, thumbnailUrl, uploadDate, …) into the
catalog row when they differ. Offline — never touches YouTube. Use this
after the transcript parser learns to extract a new field, or any time the
catalog has drifted from the on-disk gold copy. Sibling to
`src/ingest/backfill-meta.ts`, which does the network version for rows
whose transcript file is missing the field too.

During local development run via `npm run cli -- <command>` (uses `tsx`
against `src/`, no build step). After `npm run build`, the compiled binary
is at `dist/cli/index.js` and is exposed as `captions` via package.json
`bin`.

## Stage model

Each catalog row tracks a `stages` map — one record per pipeline stage with
a timestamp and the implementation version it ran against. A stage is
**stale** when it has never run, when its recorded version is below the
current implementation version, or when any of its dependencies recorded a
later timestamp. Bumping a stage's `version` field is how you force a
re-run after changing an extractor.

Per-video stages:

1. `fetched` — downloads the transcript via the rate-limited YouTube client
2. `nlp` — extracts entities + relationships, persists per-video JSON,
   upserts into the graph store, and bumps the graph-dirty watermark
3. `ai` — writes a Claude Code enrichment bundle under `data/ai/bundles/`.
   On the next run, if a matching response file exists under
   `data/ai/responses/`, the stage ingests it and marks itself complete.
   Until then it remains in `awaiting` state and re-runs every pipeline pass.
4. `per-claim` — extracts verdict claims from the transcript's summary
   region and stamps matching relationships with `directTruth`

Graph-level stages (run after any per-video stage bumps the dirty watermark):

- `propagation` — truth propagation over the full relationship graph
- `contradictions` — contradiction + loop detection; report written to
  `data/reports/conflicts.json`
- `novel` — novel-link detection; report written to `data/reports/novel.json`

## Adding a single video

```
captions add https://www.youtube.com/watch?v=ID
captions pipeline
```

The `pipeline` command walks every row and runs whatever is stale. Because
adding a video eventually bumps the graph-dirty watermark (via the `nlp`
stage), graph-level stages re-run exactly once — no need to re-process
other videos.

## Before the first run

Take a snapshot of `data/` so a bad migration can be rolled back:

```
npm run backup
```

And print the current state of the corpus:

```
npm run audit
```
