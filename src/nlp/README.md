# nlp

Walk transcripts and extract entities (people, things, times, events,
locations, organizations) and the relationships between them.

**Invariant:** every relationship MUST carry an evidence pointer
(transcript id + character/time span). No floating claims.

## Pipeline shape

```
transcript text
      │
      ├──► runNer()                  ─► raw PER / ORG / LOC mentions         ─► canonicalize ─┐
      │   (BERT, @xenova)                                                                     │
      │                                                                                      ├──► normalize() ──► extractRelationships() ──► graph
      ├──► time regex                ─► years / ISO dates / "January 5 2024"                  │
      ├──► gazetteer                 ─► orgs / locations / events / things                    │
      │   (data/gazetteer/*)                                                                  │
      └──► coref pass                ─► pronoun + last-name binding                           ┘
```

The canonicalize step ([canonicalize.ts](canonicalize.ts)) runs on raw NER
output before normalization and does three things:

1. **Stopword drop** — `God`/`Lord`/`Dad`/`Sir`/... that BERT-NER tags as
   PER in news-wire-heavy corpora. Dropped entirely.
2. **Per-transcript long-form binding** — a single-token first name like
   `"Dan"` is bound to the only multi-token mention it matches inside the
   same transcript (`"Dan Brown"`). Unbound short mentions get a
   `#<videoId>` suffix so unrelated `"Kenny"` mentions don't merge globally.
3. **Location alias collapse** — `US`/`USA`/`America`/`United States` →
   one canonical `United States`. Small hand-maintained map; extend as
   needed.
4. **Organization alias collapse** — `FBI` ↔ `Federal Bureau of Investigation`,
   `CIA`, `NSA`, `DOJ`, `FDA`, `CDC`, `NIH`, `WHO`, `UN`, `NATO`, `EU`, etc.
   Hand-curated bounded list of US federal + major intl bodies in
   [canonicalize.ts](canonicalize.ts) `ORG_CANONICALS`. Extend without a
   recompile by adding `alias<TAB>canonical` rows to
   [data/gazetteer/organization_aliases.tsv](../../data/gazetteer/organization_aliases.tsv).
   Long-tail org canonicalization is intentionally not attempted —
   similar-looking orgs are often genuinely different (DOJ ≠ DOE).

Relationship patterns in [relationships.ts](relationships.ts) each declare
allowed `subj` and `obj` entity types. Pairs that don't satisfy the types
in either orientation are skipped — this is what prevents bugs like
`Sunny located-at 2004` (a time entity on the object side of a location
predicate).

Two entity producers (`runNer` + regex/gazetteer) feed a single normalize
pass, then the relationship extractor runs on the merged entity list.

## Modules

- [canonicalize.ts](canonicalize.ts) — stopword drop, per-transcript
  first-name binding, and location alias collapse. Runs on raw NerMentions
  between `runNer()` and `extract()`.
- [entities.ts](entities.ts) — `extract(transcript, opts)`: the orchestrator.
  Accepts pre-computed `nerMentions` from the caller (the pipeline stage is
  the only real caller; tests pass a synthetic helper).
- [ner.ts](ner.ts) — lazy singleton wrapping `@xenova/transformers`
  token-classification. Loads `Xenova/bert-base-NER` (CoNLL-2003 PER/ORG/LOC)
  on first use, chunks input at sentence boundaries (~1200 chars), aggregates
  subword B-/I- tags into whole-word spans, and rebases char offsets via
  `indexOf` inside the chunk. Returns `[]` if the model fails to load —
  downstream never crashes on missing NER.
- [sentences.ts](sentences.ts) — simple sentence segmenter with an
  abbreviation guard. Used by both NER chunking and relationship pairing.
- [relationships.ts](relationships.ts) — 29 predicate patterns (regex over
  between-text), paired per sentence, not per YouTube cue. Specific-first
  ordering: `born-in` before `located-at`, `worked-for` before `member-of`.
- [gazetteer.ts](gazetteer.ts) — loads `data/gazetteer/{organization,location,
  event,thing}.txt` and merges with the in-code defaults.
- [coref.ts](coref.ts) — last-name and pronoun binding within a narrow
  window. Ambiguity-averse: skips a pronoun if the recent window contains
  more than one person.

## Predicates

`said`, `denied`, `accused`, `met`, `knows`, `married`, `lived-with`, `loves`,
`hates`, `attended`, `visited`, `located-at`, `near`, `born-in`, `died-in`,
`during`, `worked-for`, `employs`, `member-of`, `founded`, `owns`, `funded-by`,
`funds`, `investigated`, `researches`, `authored`, `cited`, `interested-in`,
`related-to`.

## Why BERT-NER and not just regex

The old capitalized-name person detector only fired on properly-cased text
and was the weakest piece of the extractor. BERT-NER strictly dominates it
on cased inputs (and is no worse on lowercase, where neither works without
truecasing). It replaces exactly one function: the person regex. Everything
else — time, gazetteer, coref, relationship patterns — is still pure JS and
does work BERT can't (dates, domain jargon, predicate verbs).

## Model cache

On first run, `@xenova/transformers` downloads `Xenova/bert-base-NER` (~400
MB ONNX) into its cache dir. Set `TRANSFORMERS_CACHE` or
`HF_HOME` to override the location if needed. Subsequent runs are offline.

Tests **never** download the model — [tests/helpers/setup.ts](../../tests/helpers/setup.ts)
injects a null pipeline at startup, and individual tests that need
deterministic NER use [tests/helpers/fake-ner.ts](../../tests/helpers/fake-ner.ts).

## Running

```bash
npm run cli -- pipeline --stage nlp           # all stale videos
npm run cli -- pipeline --video=<id> --stage nlp
```

Rerunning is non-destructive: the stage is staleness-gated by record
version. The current `nlpStage.version` in [src/pipeline/stages.ts](../pipeline/stages.ts)
controls re-run.

## Hand-edits and the overlay sidecar

Every video has two NLP files on disk:

```
data/nlp/<videoId>.json          # auto output, freely overwritten by re-runs
data/nlp/<videoId>.overlay.json  # hand-authored deltas, never touched by the pipeline
```

The overlay holds four arrays:

```jsonc
{
  "addEntities":         [ /* full Entity objects */ ],
  "removeEntities":      [ { "id": "person:dan-brown" } ],
  "addRelationships":    [ /* full Relationship objects */ ],
  "removeRelationships": [ { "id": "..." } ]
}
```

Consumers (graph store, indexes, UI) call `readMergedNlp()` /
`mergeNlpWithOverlay()` from [persist.ts](persist.ts), which produces the
effective view: `auto ∪ adds − removes`. Removes are matched on stable entity
or relationship `id`. Overlay adds whose `id` collides with an auto entry
**replace** the auto entry, so hand-edited canonicals win.

**Re-running NLP is always safe.** The pipeline rewrites the auto file from
scratch and applies the overlay on top. Your edits survive every run, even
across NLP version bumps. If a re-run no longer produces something you
previously removed, the remove entry becomes a harmless no-op.

### Editing the overlay

Two ways:

1. **Admin UI** — visit `/admin/nlp/<videoId>` in the local server. It shows
   the three layers (auto / overlay / merged) with `auto`, `added`, `removed`
   row labels, plus a textarea to edit the overlay JSON directly. Saving
   POSTs to `/api/video/<id>/nlp/overlay` and busts the in-memory caches.
2. **Hand-edit the file** under `data/nlp/<videoId>.overlay.json`. The
   pipeline never opens it for writing, so a re-run will not clobber it.

### Transcripts are also gold

Once `data/transcripts/<videoId>.json` exists on disk, `fetchAndStore()`
treats it as gold and never re-fetches. Delete the file by hand to force a
new download. This protects manual transcript edits the same way the
overlay protects NLP edits.
