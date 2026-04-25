---
name: ai-entity-resolution
description: Per-video AI coref resolution for first-name-only person entities. Use when the user asks to "run entity resolution", "resolve first-name persons", "coref-resolve <videoId>", or after new videos are added and the heuristic curator has left a long tail of first-name-only persons unresolved.
version: v1
lastVerifiedAgainstCorpus: 2026-04-24
---

# AI entity resolution (per-video coref)

Scripted AI coref for first-name-only person entities — the thing the
heuristic [ai-alias-curation](../ai-alias-curation/SKILL.md) can't get
right because it has no transcript context. Emits proposals that route
`person:paul` to `person:paul mccartney` in a Beatles video and
`person:paul benowitz` in a UFO-witness video.

Scripts live at [src/ai/entity-resolution/](../../../src/ai/entity-resolution/).

## When to run

- After `ai-alias-curation` leaves a long tail of unresolved first-name
  persons (appears in the corpus as short `person:<first>` keys alongside
  longer canonical `person:<first> <last>` counterparts).
- After a batch of new videos lands and the coref tail grows.
- Before `ai-entity-audit` — resolution folds into merges, which the
  audit then sees as already-handled.

## Steps

Do NOT parallelize `prepare` or `apply` — each reads/writes
corpus-wide state. You MAY parallelize the per-video AI verdict step
across distinct video ids if needed.

### 1. Ensure `dist/` is fresh

```
npm run build
```

Skip if `dist/graph/aliases-schema.js` is newer than the source.

### 2. Build per-video bundles

```
node src/ai/entity-resolution/prepare.mjs
```

Writes `_entity_resolution_tmp/<videoId>.bundle.json` per video that
has first-name-only persons. Each bundle carries:
- candidate short keys (e.g. `person:paul`)
- sample contexts where each short key appears in the transcript
- corpus-wide candidate full-form entities (`corpusNeighbors`)

### 3. Per-video AI verdict

For each bundle, one agent reads it and writes a proposals file with
one of the four verdicts per candidate:

- **RESOLVE-PER-VIDEO** — in *this* video, the short form unambiguously
  means a specific longer canonical. Emit
  `{videoId, from, to, rationale}` for the `videoMerges` section.
- **RESOLVE-CORPUS** — across every video that mentions this short
  form, it means the same full name. Emit `{from, to, rationale}` for
  the corpus `merges` section.
- **KEEP** — the short form is legitimate on its own (a stand-alone
  first-name reference no one disambiguates). No write.
- **DEFER** — ambiguous across videos; needs cross-video analysis or
  a human call. No write.

Proposals file shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "<ISO>",
  "videoId": "<id>",
  "agent": "claude-opus-4-7",
  "proposals": [
    { "verdict": "RESOLVE-PER-VIDEO", "videoId": "<id>", "from": "person:paul", "to": "person:paul mccartney", "rationale": "Beatles video; every 'Paul' sample refers to McCartney" },
    { "verdict": "RESOLVE-CORPUS", "from": "person:tesla", "to": "person:nikola tesla", "rationale": "corpus-wide short form always means the inventor" },
    { "verdict": "KEEP", "key": "person:steve", "rationale": "multiple distinct Steves, no single dominant resolution" },
    { "verdict": "DEFER", "key": "person:dan", "rationale": "three Dans across corpus; needs cross-video review" }
  ]
}
```

### 4. Apply

```
node src/ai/entity-resolution/apply.mjs
```

Folds every `*.proposals.json` into `data/aliases.json` via the typed
mutators. Skips any proposal conflicting with an existing `notSame`
entry. Writes a one-shot backup at
`_entity_resolution_tmp/aliases.before.json`.

### 5. Case / title / determiner normalization (pure code)

```
node src/ai/entity-resolution/normalize.mjs
```

Collapses surface-form duplicates that the heuristic curator misses:
`Dr. Ning Lee` → `Ning Lee`, `The Book of Enoch` → `Book of Enoch`,
case-only variants of the same canonical. No AI, no bundle — runs
over the whole corpus in seconds.

### 6. Rebuild indexes

```
npx captions pipeline --stage indexes
```

The indexes stage absorbs the new merges into the graph-level views.

## Quality bar

- **RESOLVE-PER-VIDEO** requires ≥ 2 sample contexts all resolving to
  the same longer canonical. One strong "I spoke with Paul McCartney"
  cue is not enough if later samples are ambiguous.
- **RESOLVE-CORPUS** requires every video that mentions the short form
  to resolve the same way. When in doubt, prefer per-video.
- Never emit a resolution to a canonical that doesn't exist in the
  corpus — apply.mjs rejects dangling targets.
- Respect `notSame`. If the operator has already asserted "person:paul
  and person:paul mccartney are different", the proposal must not
  propose that merge.

## Invariants

- NER files (`data/entities/<id>.json`, `data/relations/<id>.json`) are
  immutable. All writes flow through `data/aliases.json`.
- Never resolve across labels. `person:paul` → `organization:paul`
  is never correct. apply.mjs enforces same-label targets.
- DEFER is free — later passes (cross-video analysis, operator hand
  curation) pick up deferred items.
