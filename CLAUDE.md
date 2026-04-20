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
  as `{ name, hidden? }` objects. `hidden: true` keeps the label in GLiNER
  (still a valid relationship endpoint) but hides it from facets, search
  suggestions, the relationship graph, and the per-video entity list. The
  web side mirrors the hidden set in
  [web/src/lib/entity-visibility.ts](web/src/lib/entity-visibility.ts) —
  keep them in sync.
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
   [src/ai/curate/](src/ai/curate/) is a sibling: scripted bulk alias
   curation (Plan 1). See the "AI alias curation" section below.
6. [src/graph/](src/graph/) — storage and query layer for entities /
   edges / evidence. Adapter at [src/graph/adapt.ts](src/graph/adapt.ts)
   converts the per-video neural output (mention ids) into graph-shaped
   `Entity` and `Relationship` records (entity ids `${type}:${canonical}`).
7. [src/truth/](src/truth/) — per-relationship truthiness, propagation
   rules, contradiction and loop detection, novel-link surfacing.
8. [src/skeptic/](src/skeptic/) — speaker credibility scoring from
   transcript signals.
9. [src/ui/](src/ui/) + [src/web/](src/web/) — local dev server with
   admin UI. The React SPA at `/admin/` and the HTML-rendered
   `/admin/video/:id` unified page surface entities, relations, stage
   status, and a tuning troubleshooting table.
10. [web/](web/) — **public static site** (React + TypeScript + Vite).
   Standalone project, deployed to GitHub Pages. Reads prebuilt JSON
   from `data/` via Vite middleware in dev; for production, data files
   are copied into `dist/data/` at deploy time. No server APIs — all
   search, filtering, and graph exploration run client-side. See
   [web/ commands](#web-public-site) below.

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

graph-level (run once after all per-video stages):
  propagation → contradictions → novel → indexes
```

`aiStage.dependsOn: ["relations"]`. `perClaimStage.dependsOn: ["relations"]`.
Graph-level stages (`propagation`, `contradictions`, `novel`, `indexes`)
read the `graph.dirtyAt` watermark which gets bumped whenever `entities`
or `relations` upserts into the graph store.

## Cross-transcript canonicalization

Duplicate and junk entities across videos (e.g. "Dan" vs "Dan Brown",
"America" vs "United States", or generic nouns like "channel" /
"music") are curated via the alias system. All actions persist
immediately to `data/aliases.json` and bump `graph.dirtyAt` so the
next indexes rebuild picks them up.

### Where to do the work

- **`/admin/aliases`** — the curation hub. Three sections:
  1. **Current merges** — flat editable table of every `from → to`
     alias. Click **edit** in the target cell to change where a key
     merges into via autocomplete. Click **undo** to drop a merge.
  2. **Hidden entities** — entities you've decided should not appear
     in the graph at all (generic noise like "music", "channel").
     **unhide** to restore.
  3. **Pending clusters** — proposed merge groups built from
     substring containment + co-occurrence. Checkboxes: checked =
     same entity, unchecked = different. **save** records both
     (checked ones → merge, unchecked ones → `__not_same__` pair).
     The top-of-page search box live-filters every table and
     cluster card.
- **`/admin/entity/:key`** — per-entity page. Status badge
  (active / merged / hidden), list of videos it appears in, list of
  entities that merge into it, and the same ⋯ action menu.
- **`/admin/video/:id`** — the neural entities table has a `⋯`
  button on every row that opens the action menu inline.

### The `⋯` action menu

Universal per-entity popover. Shows:
- **hide entirely** — adds `key → __hidden__`; drops the entity (and
  every relationship that touches it) from the graph.
- **merge into…** — live-autocomplete scoped to the same label.
  Click a result to write `key → target`.
- **unmerge** / **unhide** when the entity is already in one of
  those states.

### Applying decisions

- **`rebuild graph` button** on `/admin/aliases` — runs the indexes
  stage in-process; the corpus-wide files regenerate without
  leaving the browser.
- **CLI**: `captions pipeline --stage indexes` does the same out of
  band. Works because every alias write bumps `graph.dirtyAt`.

### Data model in `data/aliases.json` (v2)

Structured JSON, one section per override kind. Human-readable so you
can eyeball a whole section at once, and AI-appendable because every
entry is a fully-qualified typed record with no compound keys.

The schema lives in [src/graph/aliases-schema.ts](src/graph/aliases-schema.ts).

```jsonc
{
  "schemaVersion": 2,
  "merges": [
    { "from": "person:dan", "to": "person:dan brown" }
  ],
  "deletedEntities": [
    { "key": "organization:music" }
  ],
  "display": [
    { "key": "person:aj gentile", "display": "AJ Gentile" }
  ],
  "notSame": [
    { "a": "person:frank", "b": "person:frank black" }
  ],
  "dismissed": [
    { "members": ["location:mexico", "location:indonesia"] }
  ],
  "videoMerges": [
    { "videoId": "abc123", "from": "person:frank", "to": "person:frank black" }
  ],
  "deletedRelations": [
    {
      "videoId": "xyz456",
      "subject": "organization:npr",
      "predicate": "funded_by",
      "object": "event:kickstarter campaign",
      "timeStart": 1243
    }
  ]
}
```

**Section semantics:**
- `merges` — `from` is the same entity as `to`; folded into `to` at aggregation.
- `deletedEntities` — this entity is dropped from the graph entirely; relations touching it also drop. "Hide" and "delete" collapsed into this one concept.
- `display` — render this entity with the provided string in place of its extracted canonical. Key unchanged.
- `notSame` — operator asserted these two entities are different. They won't be proposed together in future cluster-review rounds.
- `dismissed` — operator already reviewed this cluster; don't reappear.
- `videoMerges` — per-video alias. Applies only when aggregating that specific video.
- `deletedRelations` — suppress one specific relationship in one video. `(videoId, subject, predicate, object, timeStart)` is the natural key.

**Stable sort**: every write sorts each section by natural key, so diffs stay minimal across edits.

**Legacy v1 format** (flat `Record<string, string>` with prefixed keys like `display:`, `video:<vid>:`, `del:<vid>:`, `~~`, `||`, and sentinel values `__hidden__` / `__deleted__` / `__not_same__` / `__dismissed__`) is auto-migrated on first read. The migration writes the v2 form back atomically.

### Runtime representation

`readAliases(dataDir)` in [src/graph/canonicalize.ts](src/graph/canonicalize.ts) loads the v2 file and compiles a flat `AliasMap` for the hot-path helpers: `resolveKey`, `isDeleted`, `isRelationDeleted`, `getDisplayOverride`, `getVideoAlias`. Callers that need to mutate should use the typed helpers in `src/graph/aliases-schema.ts` (`addMerge`, `addDeletedEntity`, `addDisplay`, `addNotSame`, `addDismissed`, `addVideoMerge`, `addDeletedRelation`, plus their `remove*` counterparts).

### Adapter precedence

Per mention in [src/graph/adapt.ts](src/graph/adapt.ts) `neuralToGraph()`:

1. Apply `videoMerges` alias if set (per-video rename)
2. Resolve corpus merge chain (up to 10 hops)
3. Drop if resolved key is in `deletedEntities`
4. Entity.canonical = `display` override if set, else extracted canonical

Per edge: drop if composite `(videoId, subject, predicate, object, timeStart)` is in `deletedRelations`.

### Entity action menu

Every entity and relationship on an admin surface has a per-item menu
triggered by a visible `⋯` button (entity) or `✎` button (relation),
plus shift+click on the chip/row.

- **Admin mode** (`VITE_ADMIN=true` on the React side, always-on for
  server-rendered admin pages): all actions. Each POSTs to
  `/api/aliases/<op>`.
- **Public** (production static site): one action — "suggest an edit"
  — opens a prefilled GitHub issue (see
  [web/src/lib/issues.ts](web/src/lib/issues.ts)). Each issue body
  includes a `http://localhost:4173/admin/apply?op=…` link an admin
  can click to execute without leaving the browser.

Surfaces wired up:
- `/admin/video/:id` entities table — `⋯` menu
- `/admin/video/:id` relations table — `✎` menu
- `/admin/entity/:key` — `⋯` menu in the header
- `/admin/aliases` — flat editable list + cluster review
- `/video/:id` — `⋯` menu on entity chips, `✎` menu on relation rows
- `/relationships` — `⋯` menu in the node detail panel
- `/facets` — `⋯` menu at the end of each facet-bar row

### API surface (all local-only, no auth)

Write endpoints (POST form-urlencoded):
- `/api/aliases/delete` · `key` (alias `/hide` kept for old clients)
- `/api/aliases/undelete` · `key` (alias `/unhide` kept)
- `/api/aliases/merge` · `from`, `to`
- `/api/aliases/unmerge` · `key`
- `/api/aliases/display` · `key`, `value`
- `/api/aliases/undisplay` · `key`
- `/api/aliases/video-merge` · `videoId`, `from`, `to`
- `/api/aliases/video-unmerge` · `videoId`, `from`
- `/api/aliases/delete-relation` · `videoId`, `key` (composite)
- `/api/aliases/undelete-relation` · `videoId`, `key`
- `/api/aliases/create-phantom` · `label`, `name`, `mergeFrom?` →
  writes `display:<phantom>` and optionally merges `mergeFrom` into
  the phantom. Returns the phantom key.

Read endpoint:
- `GET /api/aliases/search?q=&label=` → top 20 entities by mention
  count whose canonical contains the query.

Indexes + apply-link endpoints:
- `POST /api/indexes/rebuild` → in-process indexes stage
- `GET /admin/apply?op=<hide|merge|display|video-merge|delete-relation>&…`
  → silent apply, redirects to `/admin/aliases?applied=<summary>&ok=0|1`
  (toast banner at page top)

All writes bust `nlpCache`, `entityIndexCache`, `entityVideosCache`,
and `relationshipsGraphCache`, and bump `graph.dirtyAt`.

### Phantom entities

When admin picks "merge into new name…" and types a string that
doesn't match any existing entity, the server writes two entries:

```
"display:<label>:<normalized_typed>": "Typed Name"   // display override
"<source_key>": "<label>:<normalized_typed>"          // merge into phantom
```

Phantoms have no mentions of their own but act as the merge target
and the display-name source for everything that merges into them.
They inherit their label from the source entity (no cross-label
promotion).

### API surface (all local-only, no auth)

- `POST /api/aliases/delete` — `key`
- `POST /api/aliases/undelete` — `key`
- `POST /api/aliases/merge` — `from`, `to`
- `POST /api/aliases/unmerge` — `key`
- `GET /api/aliases/search?q=&label=` — autocomplete feed
- `POST /api/indexes/rebuild` — in-process indexes stage

All writes bust `nlpCache`, `entityIndexCache`, `entityVideosCache`,
and `relationshipsGraphCache`, and bump `graph.dirtyAt`.

## AI alias curation (bulk, scripted)

Hand-curating every alias in `/admin/aliases` doesn't scale once the
corpus passes ~200 videos. [src/ai/curate/](src/ai/curate/) runs a
heuristic pass over the whole corpus in seconds, proposing:

- **videoMerges** — short canonical → long canonical within the same
  video when the short is a token-level subsequence of the long, both
  have ≥3-char tokens, the short isn't a common-noun (see
  `COMMON_NOUN_BLOCKLIST` in [src/ai/curate/propose.mjs](src/ai/curate/propose.mjs)),
  and exactly one such long form exists in that video. Handles
  in-video coreference like `person:paul` → `person:paul mccartney`
  in a Beatles video.
- **corpus merges** — `L:the X` → `L:X` when both exist (determiner
  dedup).
- **deletedEntities** — canonicals containing `[music]` (transcript
  marker pollution).

Respects `notSame` pairs and never touches `data/entities/<id>.json`
or `data/relations/<id>.json`. Every write is reversible via the ⋯
menu on `/admin/aliases` or by restoring the backup at
`_curate_tmp/aliases.before.json`.

**Invocation** — from a Claude Code session, ask for the
[ai-alias-curation](.claude/skills/ai-alias-curation/SKILL.md) skill
("run alias curation"). Or directly:

```
npm run build   # ensure dist/graph/aliases-schema.js is fresh
node src/ai/curate/build-corpus.mjs
node src/ai/curate/propose.mjs
node src/ai/curate/apply.mjs
npx captions pipeline --stage indexes
```

`apply.mjs` bumps `catalog.graph.dirtyAt` so graph-level stages
re-run on the next `pipeline` invocation. Re-run whenever new videos
are added; apply is idempotent — already-handled entries are skipped.

Tune by editing the blocklist / label allowlist in `propose.mjs`.
The scripts are intentionally heuristic, not neural — the tradeoff is
coverage (seconds to scan 200+ videos) vs. precision (some calls will
be wrong, which is why everything is reversible).

## Web (public site)

The [web/](web/) directory is a standalone React + TypeScript + Vite project
that produces a static site deployable to GitHub Pages.

### Commands (run from `web/`)

- `npm run dev` — Vite dev server at `http://localhost:5173/WFD/` (base
  path matches the GitHub Pages repo — override with `VITE_BASE=/foo/`).
  A custom Vite plugin serves `../data/` at `/data/` so the app reads
  real corpus data during development.
- `npm run build` — `tsc` + `vite build` + copy `index.html` → `404.html`
  for SPA deep-link support on GitHub Pages.
- `npm run preview` — preview the production build locally.

### Deploy to GitHub Pages

```bash
cd web && npm run build
cp -r ../data/catalog ../data/entities ../data/relations ../data/graph dist/data/
# optionally: cp -r ../data/transcripts dist/data/  (large; video detail degrades gracefully)
# then push dist/ to gh-pages
```

### Architecture

- **No symlink, no artifact generator.** Dev uses a Vite middleware plugin
  ([web/vite.config.ts](web/vite.config.ts)) that serves `../data/` at
  `/data/`. Build output contains only the React app; data is layered in
  at deploy time.
- **Client-side NLP adaptation.** Per-video `data/entities/<id>.json` and
  `data/relations/<id>.json` are fetched and adapted into display shapes
  by [web/src/lib/data.ts](web/src/lib/data.ts) `adaptNlp()`.
- **Client-side graph exploration.** The relationships page loads
  `data/graph/relationships-graph.json` once and does search, neighbor
  expansion, and connection queries in-browser. No server APIs.
- **Lazy loading.** The RelationshipsPage (ReactFlow + ELK, ~1.5 MB) is
  code-split and only loaded when the user navigates to `/relationships`.
- **React Router** with `basename="/captions/"` and `404.html` SPA fallback.

### Admin mode

`web/` is the **single UI codebase** for both public and admin. Admin
features (pipeline stage columns, upstream check, failed-only filter) are
gated on `import.meta.env.VITE_ADMIN`, set in `web/.env.development`.
In dev, Vite proxies `/api/*` to the local Node server on port 4173.
In production builds, `VITE_ADMIN` is unset → admin code is tree-shaken
out entirely (no admin chunk in `dist/`).

The old `src/ui/client/` SPA has been deleted. `src/ui/server.ts` now
serves only `/api/*` routes and server-rendered admin pages
(`/admin/video/:id`, `/admin/aliases`). It no longer serves the SPA shell.

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
