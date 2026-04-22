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
- **Read thesis-level claims per video** with truth + confidence bars,
  expandable evidence quotes (tight, single-sentence spans), dependency chips
  (`supports` / `contradicts` / `presupposes` / `elaborates`), typed
  `contradicts` subkinds (`logical` / `debunks` / `alternative` / `undercuts`),
  and cross-claim contradictions flagged inline.
- **See contradictions.** When two sources disagree, both claims are kept and
  surfaced side-by-side instead of one silently winning. Tabbed browser for
  pair / broken-presupposition / cross-video / manual kinds. Cross-video
  candidates go through an AI verification pass; only verdicted-real entries
  surface on the public site.
- **See cross-video agreements.** The flip side of contradictions — a
  `/cross-video-agreements` page lists pairs the verifier identified as
  asserting the same thesis in multiple videos (positive corroboration).
- **Color the relationships graph by truth.** Edges can be shaded red→green
  based on the derived truth of the claims that cite them.
- **Walk the claim graph.** A dedicated view renders claims as nodes with
  dependency, contradiction, and shared-evidence links — seed by entity,
  video, or single claim.
- **Run counterfactuals.** "What if this claim were false?" replays truth
  propagation with that claim pinned and shows which others move and by how
  much.
- **Search by tag.** Every claim and contradiction is filterable by free-form
  tag (e.g. `ufo`, `project-blue-book`, `cold-war`).
- **See novel links.** Connections that emerge from combining multiple sources,
  which no single video states directly, are flagged for review.
- **Speaker credibility over time.** Skeptic scoring tracks how a given speaker's
  claims have held up across the corpus.
- **Suggest an edit** on any entity, relationship, claim, or contradiction
  from the public site — opens a prefilled GitHub issue so the corpus can be
  corrected over time. Admin can apply the suggestion with a one-click
  localhost link included in the issue body.
- **See the quality numbers.** An admin `/admin/metrics` dashboard renders
  47 corpus-wide quality signals — entity hygiene, resolution coverage,
  evidence tightness, denies share, verdict distribution, operator corrections
  — colored by regression status vs a committed baseline.

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
   override system — see below) before writing the graph. The `indexes`
   stage auto-applies committed `DELETE_ALWAYS` (role nouns, transcript
   artifacts), `ALWAYS_PROMOTE` (famous-name short forms → full names),
   and `DELETE_LABELS` (whole labels like `quantity:*`, `role:*`,
   `law_or_policy:*` that are never graph-worthy) before writing.
8. **Truth** — per-claim truthiness is scored and propagated across the graph.
   Typed `contradicts` subkinds drive how strongly claims couple in
   propagation: `logical` / `debunks` at full weight, `alternative` at
   half, `undercuts` as a post-cap ceiling.
9. **Claims** — an AI pass reads each transcript alongside the extracted
   entities/relations and writes thesis-level claims to
   `data/claims/<videoId>.json`: text, kind, evidence quotes, truth score,
   dependencies on other claims, optional tags. The extraction prompt
   mandates atomic claims, single-sentence evidence (60–150 char target),
   calibrated `directTruth` (omitted when no basis), and aggressive
   `denies` stance usage for claims the host presents in order to reject.
10. **Claim indexes** — a graph-level stage aggregates every per-video claim
    file into corpus-wide reports (`claims-index.json`, `dependency-graph.json`,
    `contradictions.json`, `edge-truth.json`, `consonance.json`). Runs claim
    propagation + contradiction detection (pair / broken-presupposition /
    cross-video / admin-authored manual). Cross-video similarity uses
    sentence-transformer cosine when a local embedding cache is available
    (falls back to Jaccard). Filters by `contradiction-verdicts.json` so
    only AI-verdicted LOGICAL-CONTRADICTION / DEBUNKS pairs surface
    publicly; SAME-CLAIM pairs move to `consonance.json` as cross-video
    agreements. Applies operator overrides from `aliases.json` before
    reasoning.
11. **Skeptic** — per-speaker credibility is derived from how their claims fare.
12. **Web UI** — a public, read-only site lets anyone navigate the map and
    trace claims back to source. A separate admin build adds write endpoints
    to edit claim truth, text, tags, and contradictions — all through
    `data/aliases.json` so per-video files stay immutable.

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
- **Claim re-extraction invalidates verdicts.** The claim-indexes stage hashes
  each claim's text into the verdict cache. If a claim's text changes, its
  prior AI verdict is dropped and the pair re-enters the candidate pool on
  the next verification run.

## Status

All pipeline stages are implemented and running end to end. 210+ videos
processed with neural extraction, cross-transcript canonicalization, AI claim
extraction with v2 quality prompt, sentence-embedding-driven cross-video
contradiction detection, and AI verification pass. Not production-hardened
and the public site is still coming together. Expect rough edges, incomplete
data, and active changes.

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

`tools/requirements.txt` pulls in GLiNER, GLiREL, and (optionally)
`sentence-transformers` for the cross-video contradiction embedding cache.
All three are optional at runtime — the pipeline degrades gracefully if a
sidecar is missing.

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
#    novel, indexes, claim-indexes). The `indexes` stage auto-applies
#    DELETE_ALWAYS / ALWAYS_PROMOTE / DELETE_LABELS and writes the
#    aggregated graph the UI reads. The `claim-indexes` stage folds
#    in embeddings + AI verdicts and writes the claim-level reports.
npm run pipeline

# 4. Serve the local admin UI + API on :4173.
npm run dev

# 5. (Optional) run the public site dev server on :5173 for the
#    React pages (proxies /api and /admin through to :4173).
cd web && npm run dev
```

Other commands:

```bash
npm run heal              # reset failed rows + clear stale transcriptPath fields
npm run audit             # print a state summary of the catalog
npm run metrics           # print the corpus-quality dashboard
npm run metrics:baseline  # freeze current snapshot as the regression gate baseline
npm run metrics:check     # gate: exit non-zero if any metric regressed
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
- **`/admin/metrics`** — live quality dashboard (47 signals across 5
  sections) with current / baseline / target bounds per metric.

All overrides live in `data/aliases.json` as a sectioned append-only file.
The indexes stage also auto-inserts committed `DELETE_ALWAYS` /
`ALWAYS_PROMOTE` / `DELETE_LABELS` decisions from
[src/ai/curate/delete-always.ts](src/ai/curate/delete-always.ts) — those
are code-level decisions (PR-reviewed), not operator actions. See
[CLAUDE.md](CLAUDE.md) for the full aliases schema.

### AI skills invoked from Claude Code

The repository ships six Claude Code skills under `.claude/skills/`. Each is
invoked from a Claude Code session with a natural-language phrase listed in
its SKILL.md. All reads from disk; writes either land in `data/aliases.json`
through typed mutators or in `data/claims/<id>.json` with strict validation.

| Skill | When to invoke | What it does |
|---|---|---|
| **ai-alias-curation** | After new videos are added | Heuristic propose/apply pass over the corpus — per-video short→long name merges, `the X` → `X` dedup, `[music]` artifact deletions. ~25 seconds on 200+ videos. |
| **ai-entity-audit** | When high-mention entities look noisy | Tier-1 (top-100 per label) AI audit with context samples. Verdicts KEEP / DELETE-GLOBAL / MERGE-INTO / PER-VIDEO-MERGE / DEFER; parallelizable across labels. |
| **ai-entity-resolution** | After new videos add first-name-only persons | Per-video coref resolution (e.g. `person:paul` → `person:paul mccartney` in the Beatles video, → `person:paul benowitz` in the UFO video). Cross-video disambiguation for first-name persons in ≥2 videos. |
| **ai-claims-extraction** | When new videos need claim files | Per-video AI session writes `data/claims/<id>.json` — 8–15 thesis-level claims with single-sentence evidence, typed contradicts subkinds, aggressive denies stance, calibrated directTruth. Parallelizable across videos; resumable across sessions. |
| **ai-contradiction-verify** | After new claim files or claim re-extraction | Verdict cross-video contradiction candidates. Only LOGICAL-CONTRADICTION / DEBUNKS verdicts surface publicly; SAME-CLAIM verdicts become cross-video agreements. Parallelizable across candidate shards. |
| **ai-reasoning-layer** | Manual debugging / full-corpus re-run | Drives the claim-propagation + contradiction modules directly. Same result as the `claim-indexes` pipeline stage; useful when you want fine control over inputs. |
| **metrics** | Checking corpus quality | Runs the metrics CLI — print / baseline / check modes over 47 quality signals. |

### When a new video is added — full workflow

End-to-end runbook for one or more new videos. Each step is idempotent and
only stale work runs, so re-running any of them is always safe.

```bash
# 1. Add the video(s) to the catalog.
npm run add -- "https://www.youtube.com/watch?v=VIDEOID"
#    Or batch via data/seeds/videos.txt + npm run ingest.

# 2. Fetch transcripts and run per-video stages (entities → date-normalize →
#    relations → ai → per-claim) plus graph-level propagation, contradictions,
#    novel, and indexes. The indexes stage auto-applies committed entity
#    hygiene / gazetteer / label-deletion lists.
npm run ingest
npm run pipeline
```

Then in a Claude Code session, run the AI skills in order:

```
# 3. Heuristic alias curation — per-video short→long name merges, "the X" → "X"
#    dedup, [music]-artifact deletions. Fast (~25s) and reversible.
"run alias curation"

# 4. Per-video entity resolution — AI coref pass for first-name persons in
#    the new video(s). Emits per-video merges that correctly route
#    `person:paul` to `person:paul mccartney` vs `person:paul benowitz`
#    depending on each video's context.
"run entity resolution for the new videos"

# 5. Optional — AI entity audit for any tier-1 entities that bubbled up.
#    Usually not worth it for 1–3 new videos; skip unless /admin/aliases
#    surfaces new noise.
"run entity audit"

# 6. Write claim files for the new videos (v2 quality prompt is automatic).
#    For 1–10 new videos, sequential is fine:
"extract claims for 10 videos"
#    For larger batches, parallelize across agents:
"extract claims for 50 videos using 5 parallel agents"
```

Then back on the command line, fold the new claims into the cross-video
reasoning layer:

```bash
# 7. Populate the sentence-embedding cache for the new claims. Fast (~5s
#    per 100 claims). Requires sentence-transformers in tools/requirements.
#    If not installed, the cross-video detector falls back to Jaccard.
node src/ai/reasoning/embed-claims.mjs

# 8. Re-run claim-indexes. Generates cross-video contradiction candidates
#    with cosine similarity; unverified candidates land with verified:null
#    (visible in admin, filtered out of the public view).
npx captions pipeline --stage claim-indexes
```

Back in Claude Code:

```
# 9. Verdict any new cross-video contradiction candidates. Shards the pool
#    across N parallel agents and writes data/claims/contradiction-verdicts.json.
"verify contradictions"
```

One more command-line step:

```bash
# 10. Re-run claim-indexes so the new verdicts filter contradictions.json
#     and the SAME-CLAIM pairs move into consonance.json.
npx captions pipeline --stage claim-indexes

# 11. Check metrics for regressions, and if green, promote the new baseline.
npm run metrics:check
npm run metrics:baseline   # only if step 11a passed
```

After step 11, the new videos are queryable on
`http://localhost:4173/admin/video/:id` (admin) and on the public site
after a `cd web && npm run build` + deploy.

**If entities/relations come back empty** for a video with a real
transcript, the GLiNER sidecar silently failed. Re-run that stage
with `CAPTIONS_PY_DEBUG=1` to stream sidecar stderr:

```bash
CAPTIONS_PY_DEBUG=1 npx captions delete --stage entities --video <id>
CAPTIONS_PY_DEBUG=1 npx captions pipeline --video <id> --stage entities
```

Common fixes: lower `gliner.maxChunkChars` in
[config/models.json](config/models.json) if it's OOMing on a long
transcript; lower `gliner.minScore` if the model returned zero
mentions without error. See [CLAUDE.md](CLAUDE.md) for the full
diagnosis tree.

### Source tree

```
src/
├── ingest/             # youtube transcript fetcher + rate limiter
├── catalog/            # video ↔ transcript catalog, gap detection
├── entities/           # GLiNER sidecar + intra-transcript canonicalization
├── date_normalize/     # derive typed date entities from date_time mentions
├── relations/          # GLiREL sidecar + relation extraction
├── ai/                 # claude-code-driven AI passes
│   ├── curate/         #   heuristic alias proposer + DELETE_ALWAYS / ALWAYS_PROMOTE / DELETE_LABELS
│   ├── entity-audit/   #   tier-1 AI entity audit (prepare / apply / report)
│   ├── entity-resolution/  # per-video coref + canonical normalization
│   ├── claims/         #   per-video claim extraction session (v2 quality prompt)
│   ├── reasoning/      #   reasoning-layer driver + embeddings cache populator
│   ├── contradiction-verify/  # AI verdicting of cross-video candidates
│   └── calibration/    #   calibration bundle + gold-sample seed / check
├── graph/              # relationship graph, adapter, cross-transcript aliases
├── truth/              # claim propagation, typed contradicts subkinds, contradictions, novel links
├── skeptic/            # speaker-credibility scoring
├── metrics/            # 47-signal corpus-quality metrics + gate + CLI
├── ui/                 # admin UI + JSON API (node:http, no framework)
├── cli/                # captions CLI entrypoint
├── shared/             # cross-cutting types, python-bridge, embedding-bridge
└── pipeline/           # stage runner

tools/                  # python sidecars (gliner, glirel, embeddings, coref)
config/                 # runtime knobs: labels, predicates, model ids, thresholds,
                        # metrics-targets.json, metrics-baseline.json
web/                    # public static site (react + vite, github pages)
data/
├── transcripts/        # raw transcript JSON per video id (gold — never re-fetched)
├── entities/           # per-video neural entity extraction output + corpus indexes
├── relations/          # per-video neural relation extraction output
├── claims/             # per-video thesis claims + corpus-wide derived reports
│                       #   (claims-index, dependency-graph, contradictions,
│                       #   consonance, contradiction-verdicts, embeddings,
│                       #   edge-truth)
├── gold/               # operator-verified slice for the gold-sample regression gate
├── metrics/history/    # per-day snapshot history (sparkline-ready)
├── aliases.json        # single-source-of-truth for every override
└── catalog/            # video ↔ transcript catalog + stage status
```

See [CLAUDE.md](CLAUDE.md) for contributor and agent guidance, including the
full aliases-override data model.
