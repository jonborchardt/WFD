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

**Implemented across all pipeline stages.** Every module under `src/` has real
TypeScript — `ingest`, `catalog`, `entities`, `relations`, `ai`, `graph`,
`truth`, `skeptic`, `metrics`, `ui`, plus a standalone React app under `web/`.
Read the actual file before assuming behavior; the module list below describes
intent.

`npm run build` passes clean. `npm test` runs vitest only; `npm run test:ci`
also runs `npm run metrics:check` (the corpus-quality regression gate). A
single pre-existing [tests/fetcher.test.ts](tests/fetcher.test.ts) flake is
unrelated to extraction and doesn't gate anything new.

The legacy `src/nlp/` module (regex + `Xenova/bert-base-NER`) was retired and
deleted. Neural extraction now runs via Python sidecars — see below.

## Commands

- `npm run build` — `tsc` compile to `dist/`
- `npm test` — run vitest once
- `npm run test:watch` — vitest in watch mode
- `npm run test:ci` — vitest + metrics gate (used in CI)
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
- `npm run metrics` — print corpus-quality dashboard (49 signals)
- `npm run metrics:baseline` — freeze current as the gate baseline
- `npm run metrics:check` — gate: exit non-zero on regression

## Python preprocessing (required for extraction)

The entities, relations, and optionally the cross-video contradiction detector
call Python sidecars under [tools/](tools/). Node spawns them once per
transcript (or once per batch, for embeddings) with one JSON object on stdin
and reads one JSON object back from stdout — no long-lived daemon. Install once:

```
python -m pip install -r tools/requirements.txt
```

Sidecars:

- [tools/gliner_sidecar.py](tools/gliner_sidecar.py) — `gliner.GLiNER` ·
  zero-shot entity extraction · receives `{text, labels, threshold, model_id}`
- [tools/glirel_sidecar.py](tools/glirel_sidecar.py) — `glirel.GLiREL` ·
  zero-shot relation extraction · batches every eligible sentence for one
  transcript into a single spawn
- [tools/embeddings_sidecar.py](tools/embeddings_sidecar.py) —
  `sentence-transformers` · batch sentence-embedding encoder for the
  cross-video contradiction detector. Chunked-with-fallback encode path so
  one bad input row doesn't tank a big batch. Optional — absent / failing
  → Jaccard fallback on the detector side.
- [tools/coref.py](tools/coref.py) — `fastcoref` · **disabled by default** in
  [config/models.json](config/models.json) because `fastcoref==2.1.6` is
  incompatible with `transformers>=4.48`. Pin older transformers or leave off.

Graceful degradation: if Python is missing, if a package is not installed, or
if a sidecar errors, the Node wrapper logs a single warning and returns empty
output. The pipeline still runs.

Every sidecar call goes through [src/shared/python-bridge.ts](src/shared/python-bridge.ts).
The embeddings bridge wraps it at [src/shared/embedding-bridge.ts](src/shared/embedding-bridge.ts)
and adds a cache-on-write layer keyed by SHA-1(`modelId + text`). Sidecar
stderr tracebacks are trimmed to one line in console output; the full
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
  sizes, python bin, script paths, timeouts. Includes the `embeddings`
  section (model id, batch size, cosine thresholds for the cross-video
  candidate generator).
- [config/metrics-targets.json](config/metrics-targets.json) — absolute
  bounds for the metrics regression gate.
- [config/metrics-baseline.json](config/metrics-baseline.json) — committed
  snapshot that `metrics:check` compares against.

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
5. [src/ai/](src/ai/) — all the Claude-Code-driven passes. Sub-packages:
   - [src/ai/curate/](src/ai/curate/) — heuristic alias proposer + the
     committed `DELETE_ALWAYS` / `ALWAYS_PROMOTE` / `DELETE_LABELS` lists
     in [delete-always.ts](src/ai/curate/delete-always.ts). The indexes
     stage auto-applies those on every rebuild.
   - [src/ai/entity-audit/](src/ai/entity-audit/) — tier-1 AI entity
     audit (prepare bundles per label, apply proposals through typed
     mutators, impact report).
   - [src/ai/entity-resolution/](src/ai/entity-resolution/) — per-video
     coref bundle + apply + canonical-normalization pass.
   - [src/ai/claims/](src/ai/claims/) — per-video AI claim-extraction
     session (pick-videos / prepare / validate / summary).
   - [src/ai/reasoning/](src/ai/reasoning/) — reasoning-layer driver
     plus `embed-claims.mjs` (populates
     `data/claims/embeddings.json`).
   - [src/ai/contradiction-verify/](src/ai/contradiction-verify/) —
     shard + apply for the cross-video contradiction verification pass.
   - [src/ai/calibration/](src/ai/calibration/) — calibration bundle
     (few-shot examples from confirmed operator signal) + gold-sample
     seed + gold-check diff.
6. [src/claims/](src/claims/) — schema, persist helpers, and strict
   validators for `data/claims/<videoId>.json`. Written by an AI session
   (not by an automated pipeline stage). Validators enforce: every
   evidence quote must equal `flattenedText.slice(charStart, charEnd)`
   exactly; every entity key must exist in this video's entities or in
   a display-overridden alias; no pronouns; relationship ids must
   reference real edges; confidence/directTruth ∈ [0,1].
7. [src/graph/](src/graph/) — storage and query layer for entities /
   edges / evidence. Adapter at [src/graph/adapt.ts](src/graph/adapt.ts)
   converts the per-video neural output (mention ids) into graph-shaped
   `Entity` and `Relationship` records (entity ids `${type}:${canonical}`).
8. [src/truth/](src/truth/) — per-relationship and per-claim truthiness
   plus contradiction / novel-link detection. Key files:
   [claim-propagation.ts](src/truth/claim-propagation.ts) (derived truth
   over the claim DAG — coupling strength varies by typed `contradicts`
   subkind), [claim-contradictions.ts](src/truth/claim-contradictions.ts)
   (pair / broken-presupposition / cross-video; cross-video uses
   embedding cosine when available, Jaccard fallback),
   [contradicts-subkind.ts](src/truth/contradicts-subkind.ts) (parses
   the `[logical]` / `[debunks]` / `[alternative]` / `[undercuts]`
   prefix embedded in dep rationales), and
   [claim-counterfactual.ts](src/truth/claim-counterfactual.ts)
   (on-demand "if X were false, what moves?" queries).
9. [src/skeptic/](src/skeptic/) — speaker credibility scoring from
   transcript signals.
10. [src/metrics/](src/metrics/) — 49-signal corpus-quality metrics +
    gate + CLI. Per-section files (entity-hygiene, entity-resolution,
    claims, contradictions, operator-corrections) compose into
    `computeAll()`. `runGate()` compares current vs targets + baseline
    with direction-aware drift. See [§ Metrics](#metrics) below.
11. [src/ui/](src/ui/) — local dev server with admin UI. The React SPA
    at `/admin/` and the HTML-rendered `/admin/video/:id` unified page
    surface entities, relations, stage status, and a tuning
    troubleshooting table. Adds `/api/metrics` for the admin
    dashboard.
12. [web/](web/) — **public static site** (React + TypeScript + Vite).
    Standalone project, deployed to GitHub Pages. Reads prebuilt JSON
    from `data/` via Vite middleware in dev; for production, data files
    are copied into `dist/data/` at deploy time. No server APIs — all
    search, filtering, and graph exploration run client-side. See
    [§ Web (public site)](#web-public-site) below.

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
- **Claim-text hash invalidates verdicts.** The claim-indexes stage
  hashes every claim's current text and drops any AI verdict whose
  stamped hash doesn't match — so re-extracting a claim auto-re-enters
  its pairs into the verification queue on the next run.

## Stage graph

```
fetched → entities → date-normalize → relations → ai
                                               ↘
                                                →  per-claim

graph-level (run once after all per-video stages):
  propagation → contradictions → novel → indexes → claim-indexes
```

`aiStage.dependsOn: ["relations"]`. `perClaimStage.dependsOn: ["relations"]`.
Graph-level stages (`propagation`, `contradictions`, `novel`, `indexes`,
`claim-indexes`) read the `graph.dirtyAt` watermark, which gets bumped
whenever `entities` or `relations` upserts into the graph store.

**Indexes stage auto-applies committed lists.** On every run, before
building the corpus graph, the indexes stage reads
[src/ai/curate/delete-always.ts](src/ai/curate/delete-always.ts) and:
- inserts any missing `DELETE_ALWAYS` entries into
  `aliases.deletedEntities` (role nouns, transcript artifacts, tautologies),
- inserts any missing `ALWAYS_PROMOTE` entries into `aliases.merges` (famous
  short forms → full names, when both endpoints exist in the corpus),
- drops every entity whose label is in `DELETE_LABELS` (whole labels that
  are never graph-worthy on this corpus — `quantity:*`, `role:*`,
  `law_or_policy:*`).

All three are code-level decisions with PR history; they're not operator
actions. The indexes hook batches the whole apply into a single
`writeAliasesFile()` call for performance on Windows (per-entry writes
hit file-lock contention).

Additionally, **claim-file staleness**: when `entities` or `relations`
regenerates a per-video output, a top-level `_stale` marker is stamped
into `data/claims/<videoId>.json` (the file is never deleted — it
represents AI labor). The admin video page surfaces the marker as a
banner so operators know to re-run `/ai-claims-extraction` for that id.

The `claim-indexes` stage reads every `data/claims/<id>.json`, applies
the claim-level aliases sections (`claimTruthOverrides`, `claimDeletions`,
`claimFieldOverrides`, `contradictionDismissals`, `customContradictions`),
loads the optional embeddings cache and the AI verification verdict cache,
and writes five corpus files under `data/claims/`:

- `claims-index.json` — flat list with `derivedTruth` + `truthSource`
  (`direct` / `derived` / `override` / `uncalibrated`) per claim.
  Each entry also carries an optional `counterEvidence` array — the
  inbound view of intra-video `alternative` / `undercuts` dep edges
  (see below). The per-claim UI renders these as "evidence against"
  rather than contradictions.
- `dependency-graph.json` — claim DAG edges with kinds.
- `contradictions.json` — pair / broken-presupposition / cross-video /
  manual, respecting dismissals. Post-plan3 the surface model is:
  - **intra-video pair contradictions** only surface when the dep's
    subkind is `logical` or `debunks` (both sides asserted true → real
    self-contradiction). Intra-video `alternative` / `undercuts` are
    the host delivering a verdict against a claim they themselves
    introduced — those go into `claims-index.json[i].counterEvidence`,
    not `contradictions.json`, and feed truth propagation directly.
  - **broken-presupposition** requires truth-asymmetry —
    `a.directTruth ≥ 0.5 AND b.directTruth < 0.3` — so we don't
    surface presupposition chains between two equally-fringe claims.
  - **cross-video entries** filter through `contradiction-verdicts.json`:
    LOGICAL-CONTRADICTION / DEBUNKS / UNDERCUTS / ALTERNATIVE surface
    with their verdict label (the UI can tier them); COMPLEMENTARY /
    IRRELEVANT drop; SAME-CLAIM moves to `consonance.json`. Unverified
    candidates survive with `verified: null` (visible in admin,
    filtered out of the public view by
    `web/src/components/facets/claims-duck.ts`).
- `consonance.json` — SAME-CLAIM verdicts promoted to cross-video
  agreements. Rendered at `/cross-video-agreements`. Plan3 added two
  gates at promotion time: pairs whose two claims have opposed
  `hostStance` (one asserts / one denies) are rejected (not
  consonance, it's framing disagreement), and a per-video pair cap of
  4 prevents a single topical cluster from dominating the feed.
- `edge-truth.json` — `${subjectId}|${predicate}|${objectId}` →
  averaged derived truth of citing claims, for the relationships-graph
  truth overlay.

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
- **`/admin/metrics`** — live quality dashboard (see [§ Metrics](#metrics)).

### Committed (code-level) decisions

Three lists in [src/ai/curate/delete-always.ts](src/ai/curate/delete-always.ts)
carry decisions that are *not* operator actions — they're code, PR-reviewed,
auto-applied on every indexes rebuild:

- **`DELETE_ALWAYS`** — entity keys that should never be in the graph on
  this corpus (role-noun persons, transcript artifacts, outro pollution,
  tautologies, generic place nouns, generic quantities).
- **`ALWAYS_PROMOTE`** — famous short forms that unambiguously refer to
  their full forms on this corpus (`person:tesla` → `person:nikola tesla`,
  `person:aj` → `person:aj gentile`, CIA/FBI/NSA acronym dedup, etc.).
  Only applied when both endpoints exist in the current corpus.
- **`DELETE_LABELS`** — whole labels that are never graph-worthy
  (`quantity:*`, `role:*`, `law_or_policy:*`). The indexes hook folds
  every matching entity into `deletedEntities`.

Adding to these lists is a code change; the operator sees the effect on
the next `indexes` run.

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
    { "from": "person:dan", "to": "person:dan brown",
      "rationale": "optional — stored when set by AI audit / gazetteer" }
  ],
  "deletedEntities": [
    { "key": "organization:music",
      "reason": "optional — '[music] cue tag'" }
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
  ],
  "claimTruthOverrides": [
    { "claimId": "abc123:c_0002", "directTruth": 0.15, "rationale": "cited source retracted" }
  ],
  "claimDeletions": [
    { "claimId": "abc123:c_0007" }
  ],
  "claimFieldOverrides": [
    { "claimId": "abc123:c_0003", "text": "cleaner rephrased claim", "tags": ["ufo", "area-51"] }
  ],
  "contradictionDismissals": [
    { "a": "abc123:c_0001", "b": "xyz456:c_0004", "reason": "different contexts" }
  ],
  "customContradictions": [
    { "a": "abc123:c_0001", "b": "xyz456:c_0004", "summary": "operator-authored conflict the detector missed" }
  ],
  "auditLog": [
    { "at": "2026-04-22T14:00:00.000Z", "action": "merge",
      "entry": { "from": "person:tesla", "to": "person:nikola tesla" },
      "by": "indexes-hook", "batchId": "2026-04-22-auto" }
  ]
}
```

**Section semantics:**
- `merges` — `from` is the same entity as `to`; folded into `to` at aggregation.
  Optional `rationale` stored when AI / gazetteer set it.
- `deletedEntities` — this entity is dropped from the graph entirely;
  relations touching it also drop. Optional `reason` stored. "Hide" and
  "delete" collapsed into this one concept.
- `display` — render this entity with the provided string in place of its
  extracted canonical. Key unchanged.
- `notSame` — operator asserted these two entities are different. They
  won't be proposed together in future cluster-review rounds.
- `dismissed` — operator already reviewed this cluster; don't reappear.
- `videoMerges` — per-video alias. Applies only when aggregating that
  specific video.
- `deletedRelations` — suppress one specific relationship in one video.
  `(videoId, subject, predicate, object, timeStart)` is the natural key.
- `claimTruthOverrides` — pin a claim's `directTruth` (and optional
  rationale). Applied as an anchor during the `claim-indexes`
  propagation, so dependents recompute accordingly. Rendered in the UI
  as "truth 0.15 (override)".
- `claimDeletions` — drop a claim entirely from the corpus-wide index.
  Per-video claim file is never mutated.
- `claimFieldOverrides` — replace any subset of `text` / `kind` /
  `hostStance` / `rationale` / `tags` for a single claim. Omitted fields
  fall through to the on-disk value. Applied before propagation so
  overrides are consistent across reasoning + UI.
- `contradictionDismissals` — mark a detected contradiction pair (keyed
  by sorted claim ids) as not-a-conflict. Filtered out of
  `contradictions.json` at aggregation time.
- `customContradictions` — operator-authored contradictions the detector
  missed. Surface in `contradictions.json` with `kind: "manual"`.
- `auditLog` — optional append-only log of aliases mutations. Capped at
  500 rows. Used by the admin "Recently applied" view and for operator
  diagnosis. Mutators opt in via `appendAuditLog()`; bulk scripts that
  don't want to flood the log skip it.

**Stable sort**: every write sorts each section by natural key, so diffs
stay minimal across edits. (The audit log is the exception — it's
chronological.)

**Legacy v1 format** (flat `Record<string, string>` with prefixed keys
like `display:`, `video:<vid>:`, `del:<vid>:`, `~~`, `||`, and sentinel
values `__hidden__` / `__deleted__` / `__not_same__` / `__dismissed__`)
is auto-migrated on first read. The migration writes the v2 form back
atomically.

### Runtime representation

`readAliases(dataDir)` in [src/graph/canonicalize.ts](src/graph/canonicalize.ts)
loads the v2 file and compiles a flat `AliasMap` for the hot-path helpers:
`resolveKey`, `isDeleted`, `isRelationDeleted`, `getDisplayOverride`,
`getVideoAlias`. Callers that need to mutate should use the typed helpers
in `src/graph/aliases-schema.ts` (`addMerge`, `addDeletedEntity`,
`addDisplay`, `addNotSame`, `addDismissed`, `addVideoMerge`,
`addDeletedRelation`, `addClaimTruthOverride`, `addClaimDeletion`,
`setClaimFieldOverride`, `addContradictionDismissal`,
`addCustomContradiction`, plus their `remove*` counterparts).

### Adapter precedence

Per mention in [src/graph/adapt.ts](src/graph/adapt.ts) `neuralToGraph()`:

1. Apply `videoMerges` alias if set (per-video rename)
2. Resolve corpus merge chain (up to 10 hops)
3. Drop if resolved key is in `deletedEntities`
4. Entity.canonical = `display` override if set, else extracted canonical

Per edge: drop if composite `(videoId, subject, predicate, object, timeStart)`
is in `deletedRelations`.

Plan3 added a second per-edge drop: a **predicate type-filter**. The
adapter holds a static `PREDICATE_SCHEMA` table mapping each GLiREL
predicate to its allowed subject/object label sets (e.g. `located_in`
requires the object label to be `location` or `facility`; `member_of`
requires the object to be `organization` or `group_or_movement`;
`authored` requires a `person` or `organization` subject and a
`work_of_media` object). Edges whose endpoint labels don't fit the
schema are dropped before they reach the graph store. This is
corrective-only, applied at adapter read-time against the existing
per-video relations files — no GLiREL re-run. Origin: plan3 A6
flagged 40/60 relationship edges as type-confused (dates as subjects
in `located_in`, events as subjects in `member_of`, 839 person-object
`member_of` edges corpus-wide). The filter eliminated every flagged
pattern on the first rebuild.

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
- `/entity-graph` — `⋯` menu in the node detail panel
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

Read endpoints:
- `GET /api/aliases/search?q=&label=` → top 20 entities by mention
  count whose canonical contains the query.
- `GET /api/metrics` → live snapshot + gate report for the
  `/admin/metrics` dashboard.

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

`apply.mjs` bumps `catalog.graph.dirtyAt` so graph-level stages re-run
on the next `pipeline` invocation. Re-run whenever new videos are
added; apply is idempotent — already-handled entries are skipped.

## AI entity audit (tier-1)

For large corpora, a heuristic alone misses a long tail of noise and
misses semantics (e.g. role-noun persons slipping through because
their canonical isn't in the static blocklist). The
[ai-entity-audit](.claude/skills/ai-entity-audit/SKILL.md) skill runs
an AI audit over the top-100 mention-count entities per label.

Scripts: [src/ai/entity-audit/](src/ai/entity-audit/). Per-label
bundle generator, AI verdict loop (KEEP / DELETE-GLOBAL / MERGE-INTO /
PER-VIDEO-MERGE / DEFER), batched apply through typed mutators, impact
report. Parallelizable across labels (1 agent per label).

## AI entity resolution (per-video coref)

[ai-entity-resolution](.claude/skills/ai-entity-resolution/SKILL.md) runs
per-video AI coref for first-name-only person entities — the thing the
heuristic curator can't get right because it has no transcript context.

Scripts: [src/ai/entity-resolution/](src/ai/entity-resolution/).
`prepare.mjs` builds per-video bundles with sample contexts + candidate
resolutions. The AI agent writes proposals (RESOLVE-PER-VIDEO /
RESOLVE-CORPUS / KEEP / DEFER). `apply.mjs` folds them into
`videoMerges` / `merges`. `normalize.mjs` is a pure-code pass that
collapses case/title/determiner duplicates (`Dr. Ning Lee` → `Ning Lee`,
`The Book of Enoch` → `Book of Enoch`).

## AI claim extraction (per-video, AI session)

Claude reads `data/transcripts/<id>.json` plus the existing
`data/entities/<id>.json` and `data/relations/<id>.json`, extracts
8–15 thesis-level claims per video, and writes
`data/claims/<id>.json`. Schema and validators in
[src/claims/](src/claims/); session scaffolding in
[src/ai/claims/](src/ai/claims/); the playbook lives in the
[ai-claims-extraction](.claude/skills/ai-claims-extraction/SKILL.md)
skill.

A claim is a thesis (Wikipedia-section-title-worthy, debatable), not a
fact atom. Fact atoms belong in `data/relations/<id>.json`. Claims may
cite relationship ids as evidence and may declare cross-claim
dependencies (`supports` / `contradicts` / `presupposes` /
`elaborates`) — the dependency graph is what the reasoning layer
consumes.

### v2 extraction prompt (mandatory quality bar)

The skill prompt enforces a specific quality bar on every write:

- **Atomicity** — each claim is a single testable proposition. Compound
  "X and Y" claims are split into two claims linked by `supports` or
  `elaborates`.
- **Single-sentence evidence** — each `ClaimEvidence.quote` targets
  60–150 characters, hard-avoids > 300 chars. Multiple narrow evidence
  entries beat one paragraph-sized quote.
- **Calibrated `directTruth`** — omit when no real basis for judgment;
  never the default-0.5 fence-sit; set only with verdict-section
  signal, cited evidence, or widely-documented factual grounding.
- **Aggressive `denies` hostStance** — when the host presents a claim
  in order to reject it ("some people say X, but…"), the X-claim is
  extracted with `hostStance: "denies"`. Target ≥5% of claims —
  primary signal the cross-video contradiction detector keys on.
- **Typed `contradicts` subkinds** — every `contradicts` dependency's
  `rationale` begins with a tag:
  `[logical]` (strictly cannot both be true),
  `[debunks]` (A presents evidence B is false),
  `[alternative]` (competing primary explanations),
  `[undercuts]` (reduces probative value, both can be partially true).
  The tag is parsed by
  [contradicts-subkind.ts](src/truth/contradicts-subkind.ts) at read
  time. Schema stays at v1 — the subkind travels in-string.
- **Dependency coverage** — aim for ≥55% of claims to have ≥1 dep edge.
- **`promptVersion: "v2"` stamp** — every claim file carries the
  provenance field in its top-level payload. The validator in
  [src/claims/validate.ts](src/claims/validate.ts) rejects any
  `promptVersion` outside the known set (currently just `"v2"`), so a
  hand-edited `"v1"` fails loudly. The metrics gate enforces
  `claims.promptVersionV2Pct == 100` — any stray unstamped file is a
  gate failure. Backfill script:
  [tools/stamp-existing-claims.mjs](tools/stamp-existing-claims.mjs).

**Invocation** — from a Claude Code session, ask for the skill
("extract claims for N videos"). Or directly:

```
node src/ai/claims/pick-videos.mjs --count 20    # picks N videos that have entities + relations but no claim file yet
node src/ai/claims/prepare.mjs <videoId>         # writes _claims_tmp/<id>.input.json
# Claude reads the bundle, writes data/claims/<id>.json directly
node src/ai/claims/validate.mjs <videoId>        # gates each write — exits non-zero on bad payload
node src/ai/claims/summary.mjs                   # batch summary + per-video timings
```

**Resumability is automatic.** `pick-videos.mjs` filters out videos
that already have a claim file, so re-running after a killed session
picks up only the gaps. Atomic writes via temp+rename mean a partial
write can never produce a corrupt file.

**Parallelization.** Each video is independent — multiple agents can
work on disjoint slices in parallel by passing pinned ids
(`--video <id>`) instead of `--count`.

**Skip cases.** If `prepare.mjs` reports `flattenedTextLength` < 200
or `entities.count == 0`, skip the video — there's no source text or
no entity allowlist to construct valid claims against. Two upstream
failure modes produce these:
1. Transcripts marked `kind: "unavailable"` (single dummy cue) — fix
   by re-running `captions ingest` for that id, or accept it as
   permanently captionless.
2. Transcripts present but `data/entities/<id>.json` and
   `data/relations/<id>.json` are empty stubs — GLiNER/GLiREL ran but
   produced nothing. Likely silent sidecar failure; re-run
   `captions pipeline --video <id> --stage entities` with
   `CAPTIONS_PY_DEBUG=1` to inspect.

**Quality bar enforcement.** The validator does not police thesis
quality, only structural correctness. Quality is enforced in the
skill prompt. Spot-check by sampling claim files; full re-run is
cheap because writes are idempotent (delete the file and re-pick).

## Reasoning layer (pure code)

The modules in [src/truth/](src/truth/) — `claim-propagation`,
`claim-contradictions`, `claim-counterfactual` — compute derived truth
over the claim DAG, surface contradictions, and answer counterfactual
queries. Pure code, no AI session. Two ways to drive them:

1. **Pipeline stage** (preferred). `npx captions pipeline --stage claim-indexes`
   produces the corpus-wide derivative files directly.
2. **`run.mjs` driver** ([src/ai/reasoning/run.mjs](src/ai/reasoning/run.mjs)).
   Ad-hoc runs for debugging or a custom slice. Does not write
   `consonance.json` — that's a claim-indexes-stage exclusive.
   Playbook in the
   [ai-reasoning-layer](.claude/skills/ai-reasoning-layer/SKILL.md) skill.

**Embeddings** — `node src/ai/reasoning/embed-claims.mjs` populates
`data/claims/embeddings.json` via the sentence-transformer sidecar.
Idempotent, keyed by SHA-1(`modelId + text`). Needed by the cross-video
contradiction generator when the operator wants semantic (cosine)
candidate matching rather than Jaccard.

**Typed subkind coupling in propagation** — `logical` and `debunks`
pull with full weight (`contribution = 1 - v`); `alternative` pulls
at half weight (competing explanations shouldn't hammer each other);
`undercuts` doesn't pull at all — it applies a post-cap on the target
claim's derived truth at `1 - 0.2 * sourceTruth * sourceConfidence`.

## AI contradiction verification

Cross-video contradiction candidates from the detector can be noisy
(one generic entity shared + some text similarity isn't enough to
call "disagreement"). The
[ai-contradiction-verify](.claude/skills/ai-contradiction-verify/SKILL.md)
skill runs an AI verdict pass over the candidate pool.

Scripts: [src/ai/contradiction-verify/](src/ai/contradiction-verify/).
`prepare.mjs` hydrates each pair with both claims' full text,
hostStance, evidence quote, and shards across N agents. Each agent
verdicts every pair in its slice as one of:

- **LOGICAL-CONTRADICTION** — strictly cannot both be true
- **DEBUNKS** — one presents evidence the other is false
- **UNDERCUTS** — reduces probative value; both can be partially true
- **ALTERNATIVE** — competing primary explanations
- **COMPLEMENTARY** — different aspects of a shared topic; no conflict
- **IRRELEVANT** — only generic shared entities; different subjects
- **SAME-CLAIM** — same thesis in two different videos (→ consonance)

`apply.mjs` merges shard outputs into
`data/claims/contradiction-verdicts.json`, stamping each entry with
SHA-1 of both claim texts so the claim-indexes stage invalidates
stale verdicts when a claim is re-extracted.

After verdicts land, re-run `npx captions pipeline --stage claim-indexes`
so the stage filters `contradictions.json` by verdict and writes the
SAME-CLAIM pairs to `consonance.json`.

## Metrics

[src/metrics/](src/metrics/) is a 49-signal corpus-quality module,
grouped into 5 sections:

- **entity-hygiene** — total / active / deleted / merged counts,
  role-noun persons still active, tautologies still active
- **entity-resolution** — gazetteer (`ALWAYS_PROMOTE`) size + active
  count, first-name persons in ≥3 videos unresolved, case/title
  collision count
- **claims** — total, avg per video, directTruth %, denies %,
  dependency coverage %, evidence p50/p90/max chars, typed-contradicts %
- **contradictions** — pair / cross-video / broken-presupposition
  counts, pending-verify count, per-verdict counts,
  operator-authored verdicts, consonance count, embedding cache size
- **operator-corrections** — claim truth overrides, claim deletions,
  claim field overrides, contradiction dismissals, custom
  contradictions, display overrides, notSame pairs, dismissed
  clusters, deleted relations

Run via three npm scripts:

```
npm run metrics              # print grouped text dashboard
npm run metrics:baseline     # freeze current as the regression gate baseline
npm run metrics:check        # gate: exit non-zero on regression
```

Baseline lives at
[config/metrics-baseline.json](config/metrics-baseline.json); targets
at [config/metrics-targets.json](config/metrics-targets.json).

The gate is **direction-aware** — a metric going in the "better"
direction isn't a regression even if it drifts past the tolerance;
see the `HIGHER_IS_BETTER` map in
[src/metrics/index.ts](src/metrics/index.ts).

**Gold sample.** [src/ai/calibration/gold-seed.mjs](src/ai/calibration/gold-seed.mjs)
picks ~20 representative videos and snapshots their claim files into
`data/gold/claims/`. `gold-check.mjs` diffs current vs gold and exits
non-zero on "material regression" (claim count <70% of gold,
evidence p50 >2× gold, etc.). Run alongside `metrics:check` when the
operator wants a stronger smoke test.

**Calibration bundle.** `node src/ai/calibration/bundle.mjs` emits
`_calibration_tmp/examples.json` — confirmed-good signal (operator-
surviving merges / deletes / display overrides) plus corrected
signal (notSame pairs, contradiction dismissals, truth overrides,
operator verdicts) — that future AI sessions read as few-shot
context. Not a training pipeline; just example injection.

**Admin dashboard.** `/admin/metrics` (admin only, `VITE_ADMIN=true`)
hits `/api/metrics` for a live snapshot + gate report. Grid of big
numbers grouped by section, colored by regression status.

The [metrics](.claude/skills/metrics/SKILL.md) skill covers the full
playbook for operator invocation.

## When new videos are added — full runbook

End-to-end. Every step is idempotent; only stale work runs. Run from
the repo root.

### 1. Add the video(s) to the catalog

```
npm run add -- "https://www.youtube.com/watch?v=VIDEOID"
```

Or batch: edit `data/seeds/videos.txt` (one URL or id per line), then
`npm run ingest` will pick them up before fetching.

### 2. Fetch transcripts + run per-video and graph stages

```
npm run ingest
npm run pipeline
```

The pipeline walks `fetched → entities → date-normalize → relations →
ai → per-claim` per video, then graph-level `propagation →
contradictions → novel → indexes → claim-indexes`. The indexes stage
auto-applies committed `DELETE_ALWAYS` / `ALWAYS_PROMOTE` /
`DELETE_LABELS` lists.

If any new video produces empty `data/entities/<id>.json` despite a
real transcript, the GLiNER sidecar silently failed. Diagnose with:

```
CAPTIONS_PY_DEBUG=1 npx captions delete --stage entities --video <id>
CAPTIONS_PY_DEBUG=1 npx captions pipeline --video <id> --stage entities
```

The four common failure modes and their fixes:

1. **Chunk size / OOM on long transcript.** Lower
   `gliner.maxChunkChars` in
   [config/models.json](config/models.json) (try 800 or 600).
2. **Transient sidecar crash** (CUDA init, model load). Re-run; one-off.
3. **Malformed input** (ASR artifact char that breaks the tokenizer).
   Rare. If you see a Python traceback, lower `maxChunkChars` +
   re-run.
4. **Model download / cache miss.** Verify
   `python -m pip install -r tools/requirements.txt` succeeded.

If GLiNER returns an empty result without a traceback, lower
`gliner.minScore` in `config/models.json` (from 0.5 to 0.4) to
surface borderline mentions; if that works, calibrate.

### 3. Re-curate aliases (Claude Code session)

```
run alias curation
```

This invokes the [ai-alias-curation](.claude/skills/ai-alias-curation/SKILL.md)
skill — proposes per-video short→long merges, corpus-wide `the X` → `X`
dedup, `[music]` artifact deletions — applies them, rebuilds indexes.
~25 seconds.

### 4. Per-video entity resolution (Claude Code session)

```
run entity resolution for the new videos
```

Invokes [ai-entity-resolution](.claude/skills/ai-entity-resolution/SKILL.md)
for any first-name-only person entity in the new videos — emits
per-video merges that correctly route `person:paul` to
`person:paul mccartney` vs `person:paul benowitz` depending on the
video's context.

Optional step 4a: if new tier-1 entities appeared,
`run entity audit` invokes [ai-entity-audit](.claude/skills/ai-entity-audit/SKILL.md)
for per-label verdicts. Usually not worth it for 1–3 new videos.

### 5. Extract claims (Claude Code session)

```
extract claims for N videos
# or parallel for large batches:
extract claims for N videos using K parallel agents
```

[ai-claims-extraction](.claude/skills/ai-claims-extraction/SKILL.md)
writes `data/claims/<id>.json` with the v2 quality bar (atomic claims,
single-sentence evidence, typed contradicts, aggressive denies,
calibrated directTruth). Per-video wall: ~4–6 min. Token cost: ~30–45k
input + 6–8k output per video.

### 6. Populate embeddings cache

```
node src/ai/reasoning/embed-claims.mjs
```

Fast (~5 s per 100 claims). Requires `sentence-transformers` in
`tools/requirements.txt` — absence makes the cross-video detector
fall back to Jaccard.

### 7. Re-run `claim-indexes`

```
npx captions pipeline --stage claim-indexes
```

Generates `claims-index.json`, `dependency-graph.json`,
`contradictions.json`, `consonance.json`, and `edge-truth.json`.
New cross-video candidates land with `verified: null` (admin sees
them; public UI filters them out).

### 8. Verify new cross-video candidates (Claude Code session)

```
verify contradictions
```

Invokes
[ai-contradiction-verify](.claude/skills/ai-contradiction-verify/SKILL.md).
Shards the pending pool across N parallel agents, verdicts each pair,
writes `data/claims/contradiction-verdicts.json`.

### 9. Fold verdicts into public outputs

```
npx captions pipeline --stage claim-indexes
```

(Yes, second run — verdicts are a stage input, so re-running folds
the new ones in. SAME-CLAIM verdicts move into `consonance.json`;
LOGICAL-CONTRADICTION / DEBUNKS / UNDERCUTS / ALTERNATIVE stay in
`contradictions.json` with their verdict label so the UI can tier
them; COMPLEMENTARY / IRRELEVANT drop from the public view but stay
in the DAG for propagation.)

### 10. Metrics gate + baseline

```
npm run metrics:check     # ensure nothing regressed
npm run metrics:baseline  # promote new reality as the new reference
```

If `metrics:check` fails, investigate before promoting. Common causes
after a new-video batch: `claims.evidenceP50Chars` crept up if the
AI was loose on the evidence-tight rule; `claims.deniesPct` dropped
if the new videos had a host monologue style.

### 11. Deploy (optional)

New videos are immediately queryable on `http://localhost:4173/admin/video/:id`
after step 9. For the public static site:

```
cd web && npm run build
cp -r ../data/catalog ../data/entities ../data/relations ../data/graph ../data/claims dist/data/
# optionally: cp -r ../data/transcripts dist/data/  (large; video detail degrades gracefully)
# then push dist/ to gh-pages
```

## Web (public site)

The [web/](web/) directory is a standalone React + TypeScript + Vite
project that produces a static site deployable to GitHub Pages.

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
cp -r ../data/catalog ../data/entities ../data/relations ../data/graph ../data/claims dist/data/
# optionally: cp -r ../data/transcripts dist/data/  (large; video detail degrades gracefully)
# then push dist/ to gh-pages
```

### Routes

Public routes:
- `/` — catalog
- `/video/:id` — video detail with entities, relations, and a Claims
  panel (truth bars, expandable evidence, inbound+outbound dep chips,
  contradiction badges, counterfactual toggle)
- `/entity/:key` — per-entity rollup
- `/entity-graph` — ReactFlow+ELK graph with "color by truth" toggle,
  edge-detail panel listing citing claims (legacy path `/relationships`
  is kept as an alias)
- `/claims` — corpus-wide claim browser, sortable (most certain / most
  uncertain / most contradicted), filterable by kind + text + tag
- `/contradictions` — tabbed browser for pair / broken-presupposition /
  cross-video / manual contradictions, filterable by text + tag.
  Public view only shows verdicted-real pairs; pending `verified: null`
  candidates are admin-only.
- `/cross-video-agreements` — SAME-CLAIM pairs the verifier identified
  as asserting the same thesis across two videos (positive
  corroboration, the flip side of contradictions).
- `/argument-map` — ReactFlow view of a claim neighborhood seeded by
  entity, video, or claim id; edges show
  `supports`/`contradicts`/`presupposes`/`elaborates`/`shared-evidence`/
  `contradiction`; nodes colored by derived truth (legacy path
  `/claim-graph` is kept as an alias)
- `/facets`, `/about`

Admin-only adds `/admin` and:
- `/admin/metrics` — live quality dashboard
- `/admin/aliases` — alias curation hub
- `/admin/video/:id` — server-rendered per-video admin page
- `/admin/entity/:key` — per-entity admin page
- ⋯ menu on claim rows (override truth, edit text/kind/stance/
  rationale/tags, delete), ✎ menu on contradictions (dismiss,
  un-dismiss, add custom, remove custom), ⋯ menu on edges/entities.

### Architecture

- **No symlink, no artifact generator.** Dev uses a Vite middleware
  plugin ([web/vite.config.ts](web/vite.config.ts)) that serves
  `../data/` at `/data/`. Build output contains only the React app;
  data is layered in at deploy time.
- **Client-side NLP adaptation.** Per-video `data/entities/<id>.json`
  and `data/relations/<id>.json` are fetched and adapted into display
  shapes by [web/src/lib/data.ts](web/src/lib/data.ts) `adaptNlp()`.
- **Client-side graph exploration.** The relationships page loads
  `data/graph/relationships-graph.json` once and does search, neighbor
  expansion, and connection queries in-browser. No server APIs.
- **Lazy loading.** The RelationshipsPage (ReactFlow + ELK, ~1.5 MB)
  is code-split and only loaded when the user navigates to
  `/entity-graph`.
- **React Router** with `basename="/captions/"` and `404.html` SPA
  fallback.

### Admin mode

`web/` is the **single UI codebase** for both public and admin. Admin
features (pipeline stage columns, upstream check, failed-only filter,
metrics dashboard, pending-verify contradictions) are gated on
`import.meta.env.VITE_ADMIN`, set in `web/.env.development`. In dev,
Vite proxies `/api/*` to the local Node server on port 4173. In
production builds, `VITE_ADMIN` is unset → admin code is tree-shaken
out entirely (no admin chunk in `dist/`).

The old `src/ui/client/` SPA has been deleted. `src/ui/server.ts` now
serves only `/api/*` routes and server-rendered admin pages
(`/admin/video/:id`, `/admin/aliases`). It no longer serves the SPA
shell.

## Conventions

- TypeScript, ESM, Node >= 20.
- **No regex in the extraction path.** The migration from regex+BERT
  to GLiNER+GLiREL deleted `src/nlp/` wholesale. If you find yourself
  writing a pattern table for entities, predicates, or coref fallback
  — stop and ask whether the neural pipeline should handle it instead.
- Tests with vitest. Tests never download model weights and never
  spawn python — the `__set*PipelineForTests(null)` hooks in
  [tests/helpers/setup.ts](tests/helpers/setup.ts) neutralize all
  sidecars at startup.
- CLI entrypoint: `captions` (see `package.json` `bin`).
- **Web styling goes through the theme.** Every color, plus anything
  MUI doesn't already model, lives in
  [web/src/theme.ts](web/src/theme.ts). No raw hex literals in
  components — reach for `colors.entity.person` (or
  `t.palette.entity.person` inside an sx callback) instead. The theme
  has two layers: a `ramps` namespace (raw hex, grouped by hue, slot #
  = perceived luminance × 1000 snapped to 50-multiples) and a `colors`
  namespace (semantic tokens like `truth`, `entity`, `claimKind`,
  `stance`, `facet`, `surface` — every value is a ramp reference).
  Add a new color by adding the swatch to the appropriate ramp first,
  then point a semantic token at it. For spacing, typography variants,
  and breakpoints — use MUI's defaults (`sx={{ p: 1.5 }}`,
  `<Typography variant="caption">`, `{ xs, sm }`), not custom tokens.
  Only exception: HomePage's mini-illustration SVGs use raw hex
  (decorative, non-reused) — every other surface reads through the
  theme.

## Troubleshooting & tuning

The admin video page (`/admin/video/:id`) has a "Troubleshooting &
tuning" section with a symptom → fix table: noisy relations, specific
bad predicates, transcript artifact entities, common-noun over-firing,
zero raw preds, thin results, entity truncation, pronouns, self-loops.
That's the source of truth for tuning knobs and the files to edit.

## currentDate

Today's date is 2026-04-12.
