# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project-specific guidance for Claude Code working in this repo.

## What this project is

`captions` ingests video transcripts, extracts entities and relationships, scores
truthiness per claim, propagates truth across the relationship graph, and exposes
a queryable, publicly-browsable map of who/what/where — with every edge pointing
back to the original video and timestamp.

The corpus is intentionally **contested / controversial** content. The goal is
not to declare truth but to make claims, evidence, and contradictions traceable.
See [README.md](README.md) for the full capability list.

## Status

**Implemented across all pipeline stages**, but not production-hardened. Every
module under `src/` has real TypeScript — `ingest`, `catalog`, `entities`,
`relations`, `ai`, `graph`, `truth`, `skeptic`, `ui`, `web`. Read the actual
file before assuming behavior; the module list below describes intent, not a
guarantee of completeness.

`npm run build` passes clean. `npm test` passes except one pre-existing
[tests/fetcher.test.ts](tests/fetcher.test.ts) flake unrelated to extraction.

The legacy `src/nlp/` module (regex + `Xenova/bert-base-NER`) was retired and
deleted. Neural extraction now runs via Python sidecars — see below.

## Commands

- `npm run build` — `tsc` compile to `dist/`
- `npm test` — run vitest once
- `npm run test:watch` — vitest in watch mode
- `npm run lint` — eslint over `src/`
- `npm run clean` — remove `dist/`
- Single test file: `npx vitest run path/to/file.test.ts`
- Single test by name: `npx vitest run -t "test name"`
- `captions pipeline [--video <id>] [--stage <name>] [--dry-run]` — run stale
  stages over the catalog
- `captions entities --video <id>` — run the entities stage for one video
- `captions relations --video <id>` — run the relations stage (depends on
  `entities` having produced its output file)
- `captions neural --video <id>` — entities + relations in sequence

## Python preprocessing (required for extraction)

The entities and relations stages call Python sidecars under [tools/](tools/).
Node spawns them once per transcript with one JSON object on stdin and reads
one JSON object back from stdout — no long-lived daemon. Install once:

```
python -m pip install -r tools/requirements.txt
```

Sidecars:

- [tools/gliner_sidecar.py](tools/gliner_sidecar.py) — `gliner.GLiNER` ·
  zero-shot entity extraction · receives `{text, labels, threshold, model_id}`
- [tools/glirel_sidecar.py](tools/glirel_sidecar.py) — `glirel.GLiREL` ·
  zero-shot relation extraction · batches every eligible sentence for one
  transcript into a single spawn
- [tools/coref.py](tools/coref.py) — `fastcoref` · **disabled by default** in
  [config/models.json](config/models.json) because `fastcoref==2.1.6` is
  incompatible with `transformers>=4.48`. Pin older transformers or leave off.

Graceful degradation: if Python is missing, if a package is not installed, or
if a sidecar errors, the Node wrapper logs a single warning and returns empty
mentions/edges. The pipeline still runs.

Every sidecar call goes through [src/shared/python-bridge.ts](src/shared/python-bridge.ts).
Sidecar stderr tracebacks are trimmed to one line in console output; the full
traceback is available in the error field on the returned result. Set
`CAPTIONS_PY_DEBUG=1` to see sidecar stderr live.

Config lives in:

- [config/entity-labels.json](config/entity-labels.json) — 14 GLiNER labels
- [config/relation-labels.json](config/relation-labels.json) — 29 predicates
  with per-predicate thresholds
- [config/models.json](config/models.json) — model ids, thresholds, chunk
  sizes, python bin, script paths, timeouts

## Architecture

Pipeline shape, roughly in order:

1. [src/ingest/](src/ingest/) — fetch transcripts from YouTube,
   self-rate-limit, write to local `data/`.
2. [src/catalog/](src/catalog/) — maintain the video ↔ transcript catalog;
   expose "what's missing" queries. Schema version 5.
3. [src/entities/](src/entities/) — entity extraction. Runs GLiNER via the
   Python sidecar, canonicalizes mentions intra-transcript (longest or
   most-frequent form wins per `(label, normalized-surface)` cluster),
   filters pronouns and transcript artifacts, writes
   `data/entities/<id>.json`. Labels are loaded at runtime from
   [config/entity-labels.json](config/entity-labels.json). Coref is an
   optional pre-pass (currently off).
4. [src/relations/](src/relations/) — relation extraction. Depends on the
   entities output. Groups cues into relation-sized windows (~500 chars),
   enumerates proximity-capped mention pairs per window, sends every
   window to GLiREL in one batched Python spawn, applies per-predicate
   thresholds, enforces the evidence invariant, writes
   `data/relations/<id>.json`. Predicates and thresholds come from
   [config/relation-labels.json](config/relation-labels.json).
5. [src/ai/](src/ai/) — Claude-Code-driven enrichment that runs *after*
   relations, refining and adding relationships. This is **not** a runtime
   API call to Claude — it's a batch pass invoked via Claude Code.
6. [src/graph/](src/graph/) — storage and query layer for entities /
   edges / evidence. Adapter at [src/graph/adapt.ts](src/graph/adapt.ts)
   converts the per-video neural output (mention ids) into graph-shaped
   `Entity` and `Relationship` records (entity ids `${type}:${canonical}`).
7. [src/truth/](src/truth/) — per-relationship truthiness, propagation
   rules, contradiction and loop detection, novel-link surfacing.
8. [src/skeptic/](src/skeptic/) — speaker credibility scoring from
   transcript signals.
9. [src/ui/](src/ui/) + [src/web/](src/web/) — navigation, graph
   visualization, public read-only site. The React SPA at `/admin/` and
   the HTML-rendered `/admin/video/:id` unified page surface entities,
   relations, stage status, and a tuning troubleshooting table.

### Shared types

Cross-cutting type definitions live in [src/shared/types.ts](src/shared/types.ts).
The `EntityLabel` union is the authoritative 14-label list (must stay in sync
with [config/entity-labels.json](config/entity-labels.json)); `RelationshipType`
is the authoritative 29-predicate union (must stay in sync with
[config/relation-labels.json](config/relation-labels.json)). `isValidRelationship`
and `createRelationship` are defined here — both enforce the evidence invariant.

## Invariants

- **Evidence is mandatory.** Every extracted relationship and every truth
  judgment must point back to a specific transcript span. No floating
  claims. Enforced in `createRelationship` and in the graph store
  `upsertRelationship`.
- **Rate limiting is mandatory** for any code that talks to YouTube. Don't
  add a fetch path that bypasses the limiter.
- **Transcripts are gold.** Once `data/transcripts/<id>.json` exists,
  `fetchAndStore()` returns the on-disk copy and never re-fetches. Delete
  the file by hand to force a refresh. `fetchAndStore` returns
  `{ path, meta, cached }` so callers can distinguish "real fetch just
  happened" from "gold guard hit"; only real fetches advance
  `stages.fetched.at`.
- **Staleness is purely timestamp-driven.** There is no `version` field on
  stage records. A stage runs iff its record is missing or any of its
  dependencies has a more recent `at`. Force a re-run by deleting the
  transcript (full cascade) or by deleting the specific stage record from
  `catalog.json` (surgical). Do not reintroduce a version field.
- **Entities/relations regeneration invalidates AI artifacts.** When
  `entitiesStage` or `relationsStage` rewrites its per-video output, it
  unlinks `data/ai/bundles/<id>.bundle.json` and stamps a top-level
  `_stale` marker onto `data/ai/responses/<id>.response.json` if present.
  Response files are never deleted — they represent operator labor — but
  the marker tells the admin UI and CLI to flag them for review.
- **Neural output is not hand-edited.** The `/admin/video/<id>` page is
  read-only. Refinement of entities/relationships happens downstream in
  the `ai` stage, not by editing `data/entities/<id>.json` or
  `data/relations/<id>.json`.
- **Local-first.** Transcripts and the index live under `data/`
  (gitignored). Don't commit corpus content.
- **Read-only public surface.** The public web tier never mutates the
  graph directly; comments / edit requests go through a separate queue.

## Stage graph

```
fetched → entities → relations → ai
                  ↘        ↘
                   →  per-claim
```

`aiStage.dependsOn: ["relations"]`. `perClaimStage.dependsOn: ["relations"]`.
Graph-level stages (`propagation`, `contradictions`, `novel`, `indexes`)
read the `graph.dirtyAt` watermark which gets bumped whenever `entities`
or `relations` upserts into the graph store.

## Conventions

- TypeScript, ESM, Node >= 20.
- **No regex in the extraction path.** The migration from regex+BERT to
  GLiNER+GLiREL deleted `src/nlp/` wholesale. If you find yourself writing
  a pattern table for entities, predicates, or coref fallback — stop and
  ask whether the neural pipeline should handle it instead.
- Tests with vitest. Tests never download model weights and never spawn
  python — the `__set*PipelineForTests(null)` hooks in
  [tests/helpers/setup.ts](tests/helpers/setup.ts) neutralize all three
  sidecars at startup.
- CLI entrypoint: `captions` (see `package.json` `bin`).

## Troubleshooting & tuning

The admin video page (`/admin/video/:id`) has a "Troubleshooting & tuning"
section with a symptom → fix table: noisy relations, specific bad
predicates, transcript artifact entities, common-noun over-firing, zero
raw preds, thin results, entity truncation, pronouns, self-loops. That's
the source of truth for tuning knobs and the files to edit.

## currentDate

Today's date is 2026-04-12.
