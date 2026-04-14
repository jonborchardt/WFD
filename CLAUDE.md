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
module under `src/` has real TypeScript — ingest, catalog, nlp, ai, graph,
truth, skeptic, ui, web. Read the actual file before assuming behavior; the
module list below describes intent, not a guarantee of completeness.

`npm run build` passes clean. `npm test` passes except one pre-existing
[tests/fetcher.test.ts](tests/fetcher.test.ts) flake unrelated to NLP.

On first `pipeline --stage nlp` (or `ai`), `@xenova/transformers` downloads
`Xenova/bert-base-NER` (~400 MB) into its cache. Subsequent runs are
offline. Tests never download the model — see
[tests/helpers/setup.ts](tests/helpers/setup.ts).

## Commands

- `npm run build` — `tsc` compile to `dist/`
- `npm test` — run vitest once
- `npm run test:watch` — vitest in watch mode
- `npm run lint` — eslint over `src/`
- `npm run clean` — remove `dist/`
- Single test file: `npx vitest run path/to/file.test.ts`
- Single test by name: `npx vitest run -t "test name"`

## Architecture

Pipeline shape, roughly in order:

1. `src/ingest/` — fetch transcripts from YouTube, self-rate-limit, write to
   local `data/`.
2. `src/catalog/` — maintain the video ↔ transcript catalog; expose "what's
   missing" queries.
3. `src/nlp/` — entity + relationship extraction. Two entity producers feed
   one merge: neural NER (`src/nlp/ner.ts`, BERT via `@xenova/transformers`)
   for persons/orgs/locations, and regex + gazetteer for times/dates/events/
   domain jargon. Relationships come from a 29-predicate regex pattern table
   in `src/nlp/relationships.ts`, paired per sentence (not per YouTube cue).
   Every relationship MUST carry an evidence pointer (transcript id +
   character/time span). See [src/nlp/README.md](src/nlp/README.md) for
   pipeline shape, model choice, and cache notes.
4. `src/ai/` — Claude-Code-driven enrichment that runs *after* NLP, refining
   and adding relationships. This is **not** a runtime API call to Claude — it's
   a batch pass invoked via Claude Code.
5. `src/graph/` — storage and query layer for entities/edges/evidence.
6. `src/truth/` — per-relationship truthiness, propagation rules, contradiction
   and loop detection, novel-link surfacing.
7. `src/skeptic/` — real-time speaker credibility scoring from transcript signals.
8. `src/ui/` + `src/web/` — navigation, graph visualization, public read-only site.

## Invariants

- **Evidence is mandatory.** Every extracted relationship and every truth
  judgment must point back to a specific transcript span. No floating claims.
- **Rate limiting is mandatory** for any code that talks to YouTube. Don't add
  a fetch path that bypasses the limiter.
- **Local-first.** Transcripts and the index live under `data/` (gitignored).
  Don't commit corpus content.
- **Read-only public surface.** The public web tier never mutates the graph
  directly; comments / edit requests go through a separate queue.

## Conventions

- TypeScript, ESM, Node >= 20.
- Tests with vitest. UI tools and YouTube fetchers especially need tests
  (capability #5 in the README).
- CLI entrypoint: `captions` (see `package.json` `bin`).

## currentDate

Today's date is 2026-04-12.
