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
- **Suggest an edit** on any entity or relationship from the public site —
  opens a prefilled GitHub issue so the corpus can be corrected over time.

## How it works

The pipeline runs roughly in this order:

1. **Ingest** — fetch transcripts from YouTube, politely rate-limited, stored locally.
2. **Catalog** — track which videos we have, which we're missing, and what's stale.
3. **Entities** — zero-shot neural entity extraction (GLiNER via a Python
   sidecar). Fourteen labels: person, organization, location, facility, event,
   date_time, role, technology, and more.
4. **Date-normalize** — derive typed date entities (year, decade, specific
   date/week/month, time_of_day) from the raw `date_time` mentions.
5. **Relations** — zero-shot neural relation extraction (GLiREL via a Python
   sidecar). Twenty-nine predicates with per-predicate thresholds. Every
   relationship carries a pointer to the exact span it came from.
6. **AI enrichment** — a batch pass refines and adds relationships the
   extractors missed. Not a runtime API call; operator runs it via Claude Code.
7. **Graph** — entities, edges, and evidence are stored in a queryable graph.
   An adapter layer applies cross-transcript canonicalization (the aliases
   override system — see below) before writing the graph.
8. **Truth** — per-claim truthiness is scored and propagated across the graph.
   Contradictions and circular reasoning are detected.
9. **Skeptic** — per-speaker credibility is derived from how their claims fare.
10. **Web UI** — a public, read-only site lets anyone navigate the map and
    trace claims back to source.

## Ground rules

- **Evidence is mandatory.** No floating claims. Every relationship and every
  truth judgment must point to a transcript span.
- **Read-only in public.** The public site never mutates the graph. Corrections
  go through GitHub issues via a suggest-an-edit flow on every entity and
  relationship.
- **Local-first.** Transcripts and the derived index live on disk; the corpus
  itself is not committed to this repo.
- **No regex in the extraction path.** The neural pipeline (GLiNER + GLiREL)
  replaced the old regex+BERT extractor wholesale. Patterns belong in config
  files and alias overrides, not code.

## Status

All pipeline stages are implemented and running. 200+ videos processed end to
end with neural extraction, cross-transcript canonicalization, and truth
propagation. Not production-hardened and the public site is still coming
together. Expect rough edges, incomplete data, and active changes.

## Contributing

Want to help, report a bad claim, suggest a source, or just ask a question?
Open a GitHub issue on this repo, or use the **suggest an edit** menu on any
entity or relationship in the public site — it prefills a structured issue
automatically.

## Running it yourself

Requires Node >= 20 and Python 3 (for the extraction sidecars).

```bash
npm install
python -m pip install -r tools/requirements.txt
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

# 3. Run the staged pipeline: entities → date-normalize → relations →
#    ai → per-claim, then graph stages (propagation, contradictions,
#    novel, indexes). The `indexes` stage writes the aggregated files
#    the UI reads.
npm run pipeline

# 4. Serve the local admin UI + API on :4173.
npm run dev

# 5. (Optional) run the public site dev server on :5173 for the
#    React pages (proxies /api and /admin through to :4173).
cd web && npm run dev
```

Other commands:

```bash
npm run heal    # reset failed rows + clear stale transcriptPath fields
npm run audit   # print a state summary of the catalog
npm run cli -- status [--video ID]   # per-row stage map
npm run cli -- neural --video ID     # entities + relations for one video
```

The `ai` stage is a checkpoint: it writes a Claude Code prompt bundle under
`data/ai/bundles/<id>.bundle.json` and parks the row as `awaiting`. Run Claude
Code against the bundle, drop the reply at
`data/ai/responses/<id>.response.json`, then re-run `npm run pipeline` to ingest
it. Re-running the pipeline is always safe — stages are idempotent and only
stale work runs.

### Curation and overrides (admin only, localhost)

Extraction is never perfect. The admin UI at `http://localhost:4173/admin`
lets you curate the corpus without touching per-video extraction output:

- **`/admin/video/:id`** — all entities and relationships for one video, with
  a ⋯ menu on each for hide / rename / merge actions.
- **`/admin/entity/:id`** — every video an entity appears in, with the same
  action menu.
- **`/admin/aliases`** — flat editable list of all overrides; search bar,
  cluster-review for proposed merges, and a **rebuild graph** button that
  re-aggregates in-process.

All overrides live in `data/aliases.json` as a flat append-only file. See
[CLAUDE.md](CLAUDE.md) for the full schema.

#### Bulk curation (AI-driven)

When new videos are added, per-video short-name → full-name coreference
(e.g. `person:paul` → `person:paul mccartney` in a Beatles video) needs
to be re-proposed across the corpus. Rather than curating every entity by
hand, invoke the **[ai-alias-curation](.claude/skills/ai-alias-curation/SKILL.md)**
skill from Claude Code:

```
# In a Claude Code session:
"run alias curation"
```

It runs [src/ai/curate/](src/ai/curate/) over the whole corpus — propose,
inspect, apply, rebuild — in ~25 seconds. The heuristic respects existing
`notSame` pairs and operator decisions. Every write is reversible via the
⋯ menu on `/admin/aliases` or by restoring `_curate_tmp/aliases.before.json`.

#### Claim extraction (AI-driven, per-video)

Each video also gets 3–15 thesis-level claims with evidence quotes,
direct-truth scores, and cross-claim dependencies — written to
`data/claims/<id>.json` by an AI session. Invoke the
**[ai-claims-extraction](.claude/skills/ai-claims-extraction/SKILL.md)**
skill from Claude Code:

```
# In a Claude Code session, after a few new videos were ingested:
"extract claims for 5 videos"
# Or for full-corpus parallel runs:
"extract claims for 50 videos using 5 parallel agents"
```

It runs [src/ai/claims/](src/ai/claims/) — picks N videos that have
entities + relations but no claim file yet, packages each input
bundle, validates each write, and prints a per-video timing summary.
Resumable across sessions: `pick-videos.mjs` filters out done videos
automatically, so a killed session re-picks only the gaps.

For corpus health gaps that block claim extraction (videos with
unavailable transcripts or empty NER output), see
[plans/04-claims-coverage-gaps.md](plans/04-claims-coverage-gaps.md).

### When a new video is added — full workflow

End-to-end runbook for one or more new videos. Each step is idempotent
and only stale work runs, so re-running the whole sequence is always
safe.

```bash
# 1. Add the video(s).
npm run add -- "https://www.youtube.com/watch?v=VIDEOID"
#    Or batch via data/seeds/videos.txt + npm run ingest.

# 2. Fetch transcripts.
npm run ingest

# 3. Run all per-video pipeline stages (entities → date-normalize →
#    relations → ai → per-claim) and graph-level stages (propagation,
#    contradictions, novel, indexes).
npm run pipeline
```

Then in a Claude Code session, run the two AI skills:

```
# 4. Re-curate aliases against the expanded corpus
#    (per-video coreference, deletes [music] artifacts, etc.).
"run alias curation"

# 5. Write claim files for the new videos.
#    For 1–10 new videos, sequential is fine:
"extract claims for 10 videos"
#    For larger batches, parallelize across agents:
"extract claims for 50 videos using 5 parallel agents"
```

After all five steps, the new videos are queryable on
`http://localhost:4173/admin/video/:id` (admin) and on the public
site after a `web && npm run build` + deploy.

If any video shows up with empty entities/relations after step 3 or
gets skipped by the claim extraction in step 5, follow
[plans/04-claims-coverage-gaps.md](plans/04-claims-coverage-gaps.md)
to diagnose the upstream NER failure.

### Source tree

```
src/
├── ingest/          # youtube transcript fetcher + rate limiter
├── catalog/         # video ↔ transcript catalog, gap detection
├── entities/        # GLiNER sidecar + intra-transcript canonicalization
├── date_normalize/  # derive typed date entities from date_time mentions
├── relations/       # GLiREL sidecar + relation extraction
├── ai/              # claude-code-driven enrichment pass
├── graph/           # relationship graph, adapter, cross-transcript aliases
├── truth/           # truthiness propagation, contradictions, novel links
├── skeptic/         # speaker-credibility scoring
├── ui/              # admin UI + JSON API (node:http, no framework)
├── cli/             # captions CLI entrypoint
├── shared/          # cross-cutting types, python-bridge
└── pipeline/        # stage runner

tools/               # python sidecars (gliner, glirel, coref)
config/              # runtime knobs: labels, predicates, model ids, thresholds
web/                 # public static site (react + vite, github pages)
```

See [CLAUDE.md](CLAUDE.md) for contributor and agent guidance, including the
full aliases-override data model.
