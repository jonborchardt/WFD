# captions

**Trace claims back to the tape.**

`captions` ingests a large corpus of video transcripts — much of it contested or
controversial — and builds a queryable map of the people, places, organizations,
and claims inside them. Every relationship and every truth judgment points back
to a specific video and timestamp, so you can always watch the moment the claim
was actually made.

The goal is not to declare what is true. The goal is to make claims, evidence,
and contradictions **traceable**.

## What you can do with it

- **Look up a topic, person, or organization** and get a relationship map of
  how they connect to everything else in the corpus.
- **Click any edge** to jump straight to the transcript span — and the video
  timestamp — where the claim was made.
- **See contradictions.** When two sources disagree, both claims are kept and
  surfaced side-by-side instead of one silently winning.
- **See novel links.** Connections that emerge from combining multiple sources,
  which no single video states directly, are flagged for review.
- **Speaker credibility over time.** Skeptic scoring tracks how a given speaker's
  claims have held up across the corpus.

## How it works

The pipeline runs roughly in this order:

1. **Ingest** — fetch transcripts from YouTube, politely rate-limited, stored locally.
2. **Catalog** — track which videos we have, which we're missing, and what's stale.
3. **NLP extraction** — pull entities and relationships out of each transcript.
   Every relationship carries a pointer to the exact span it came from.
4. **AI enrichment** — a batch pass refines and adds relationships the first
   NLP stage missed.
5. **Graph** — entities, edges, and evidence are stored in a queryable graph.
6. **Truth** — per-claim truthiness is scored and propagated across the graph.
   Contradictions and circular reasoning are detected.
7. **Skeptic** — per-speaker credibility is derived from how their claims fare.
8. **Web UI** — a public, read-only site lets anyone navigate the map and trace
   claims back to source.

## Ground rules

- **Evidence is mandatory.** No floating claims. Every relationship and every
  truth judgment must point to a transcript span.
- **Read-only in public.** The public site never mutates the graph. Corrections
  and edit requests go through a separate review queue.
- **Local-first.** Transcripts and the derived index live on disk; the corpus
  itself is not committed to this repo.

## Status

Early. All pipeline stages are implemented in some form, but nothing here is
production-hardened and the public site is still coming together. Expect rough
edges, incomplete data, and active changes.

## Contributing

Want to help, report a bad claim, suggest a source, or just ask a question?
Open a GitHub issue on this repo. That's the whole process for now — no PR
template, no Discord, no mailing list. Just issues.

## Running it yourself

Requires Node >= 20.

```bash
npm install
npm run build
npm test
```

### Adding videos and building the index

The pipeline is split into explicit steps. Each is its own npm script — nothing
runs implicitly, so you always know what's happening and when.

```bash
# 1. Add videos to the catalog.
#    Either edit data/seeds/videos.txt (one url or id per line),
#    or drop one in directly:
npm run add -- "https://www.youtube.com/watch?v=VIDEOID"

# 2. Fetch transcripts for any pending / failed-retryable rows.
#    Also loads data/seeds/videos.txt into the catalog first,
#    so you can batch-edit the seed file and run this once.
npm run ingest

# 3. Run the staged pipeline: nlp → ai → per-claim, then graph
#    stages (propagation, contradictions, novel, indexes). The
#    `indexes` stage writes the aggregated files the UI reads.
npm run pipeline

# 4. Serve the UI (read-only; no background work on boot).
npm run dev
```

Other commands:

```bash
npm run heal    # reset failed rows + clear stale transcriptPath fields
npm run audit   # print a state summary of the catalog
npm run cli -- status [--video ID]   # per-row stage map
```

The `ai` stage is a checkpoint: it writes a Claude Code prompt bundle under
`data/ai/bundles/<id>.bundle.json` and parks the row as `awaiting`. Run Claude
Code against the bundle, drop the reply at
`data/ai/responses/<id>.response.json`, then re-run `npm run pipeline` to ingest
it. Re-running the pipeline is always safe — stages are idempotent and only
stale work runs.

```
src/
├── ingest/     # youtube transcript fetcher + rate limiter
├── catalog/    # video <-> transcript catalog, gap detection
├── nlp/        # entity + relationship extraction
├── ai/         # claude-code-driven enrichment pass
├── graph/      # relationship graph store and queries
├── truth/      # truthiness, propagation, contradiction & loop detection
├── skeptic/    # speaker-credibility scoring
├── ui/         # navigation + graph visualization
├── web/        # public read-only site
├── cli/        # captions CLI entrypoint
└── shared/     # cross-cutting types and utilities
```

See [CLAUDE.md](CLAUDE.md) for contributor and agent guidance.
