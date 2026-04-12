# captions

Take a large corpus of (often contested) video, pull transcripts, and try to figure
out **what is actually true in the world** — by extracting entities, mapping their
relationships, scoring truthiness, and letting people query and trace every claim
back to the original video and timestamp.

## Goals

The end-user goal: a person logs in, looks up a topic, and gets back a relationship
map plus pointers into the source video (with time slices).

## Tasks

Ordered by dependency. Check items off as they land.

### Phase 1 — Ingest & catalog

- [x] **Rate limiter** — self-throttling client used by every YouTube call. Build this *before* any fetcher so nothing can bypass it.
  - [ ] Pick limits (req/sec, daily cap, per-host) and document the rationale
  - [ ] Token-bucket or leaky-bucket implementation with persistent state across runs
  - [ ] Backoff + jitter on 429 / 5xx responses
  - [ ] Single shared instance wired so direct fetches are impossible (export only the limited client)
  - [ ] Tests: burst, sustained, backoff, persistence across restart

- [x] **YouTube transcript fetcher** — pull transcripts for a given video id, write to `data/transcripts/`.
  - [ ] Resolve video id → available caption tracks (auto vs. manual, language)
  - [ ] Download chosen track and normalize to a common transcript format (with timestamps)
  - [ ] Write to `data/transcripts/<video-id>.<ext>` atomically
  - [ ] Handle missing-captions / private / removed video cases distinctly
  - [ ] Always go through the rate limiter; never instantiate a raw HTTP client

- [x] **Video ↔ transcript catalog** — durable catalog mapping each video to its transcript file (and back).
  - [ ] Define catalog schema (video id, source url, title, channel, transcript path, fetched-at, status)
  - [ ] Pick storage (sqlite vs. json file) and put it under `data/catalog/`
  - [ ] CRUD operations + lookup by video id and by transcript path
  - [ ] Migration / versioning so schema changes don't wipe the catalog
  - [ ] Import path: given a list of video ids/urls, seed catalog rows in `pending` state

- [x] **Gap detection** — identify videos with no transcript and queue them for another fetch attempt or a user action.
  - [ ] Query: list catalog rows where transcript is missing or stale
  - [ ] Classify gaps: retryable (transient fail) vs. needs-user-action (no captions exist)
  - [ ] Retry queue with attempt count + last-error
  - [ ] User-action queue: human-readable list with the reason and what's needed
  - [ ] CLI command to print the current gap report

- [x] **Fetch-tool tests** — vitest coverage for the YouTube fetcher and rate limiter.
  - [ ] Mock YouTube responses (success, no-captions, 404, 429)
  - [ ] Verify rate limiter is on the call path (no fetcher test can bypass it)
  - [ ] Catalog round-trip: fetch → write → catalog row exists with correct fields
  - [ ] Gap detector returns the right buckets for a seeded catalog
  - [ ] Atomic-write test: interrupted write doesn't leave half-files

### Phase 2 — Navigation UI

- [x] **Navigation UI** — browse the catalog of videos and transcripts.
  - [ ] Pick UI stack (likely a small local web app served by the CLI)
  - [ ] List view: paginated catalog with status, channel, fetched-at
  - [ ] Detail view: video metadata + transcript with timestamps
  - [ ] Search / filter (by channel, status, date, free text in transcript)
  - [ ] Link from any transcript line back to the source video at that timestamp

- [x] **UI tests** — vitest coverage for the navigation UI.
  - [ ] Render list view from a seeded catalog
  - [ ] Detail view loads transcript and renders timestamps
  - [ ] Search filters narrow results correctly
  - [ ] Click-through from transcript line produces the right deep link
  - [ ] Empty / loading / error states render

### Phase 3 — Extraction

- [x] **NLP entity extraction** — pull people, things, times, events, locations, organizations from transcripts.
  - [ ] Pick NLP library / model and document the choice
  - [ ] Define the entity type set (people, things, times, events, locations, organizations) and their schemas
  - [ ] Run extraction over a transcript and emit entities with span offsets
  - [ ] Entity normalization / dedup (same person mentioned 10 ways → one canonical entity)
  - [ ] Tests over a small fixture transcript with hand-labeled expected entities

- [x] **NLP relationship extraction** — extract relationships between entities; every relationship MUST carry a transcript-span evidence pointer.
  - [ ] Define relationship type set (said, met, attended, worked-for, located-at, …)
  - [ ] Extract candidate relationships from co-occurring entities + dependency parse
  - [ ] Attach evidence pointer (transcript id + char span + time span) — invariant: no relationship without evidence
  - [ ] Confidence score per relationship
  - [ ] Tests: relationships emitted from a fixture transcript include evidence and pass shape validation

- [x] **Graph store** — persist entities, relationships, and evidence pointers; expose basic queries.
  - [ ] Pick storage (sqlite + relational tables, or a graph db) and document the trade-off
  - [ ] Schema: entities, relationships, evidence, with foreign keys to catalog
  - [ ] Insert / upsert APIs that enforce the evidence-required invariant
  - [ ] Lookup APIs: by entity, by relationship type, by source transcript
  - [ ] Migration support so schema changes don't require a full re-extract

- [x] **AI enrichment pass** — Claude-Code-driven batch pass that refines existing relationships and surfaces ones NLP missed.
  - [ ] Batch driver: iterate transcripts (or graph slices) and feed them to Claude Code
  - [ ] Prompt design: include extracted entities + transcript spans, ask for missed/refined relationships
  - [ ] Parse responses into the same relationship schema (with evidence pointers)
  - [ ] Mark AI-derived relationships distinctly (provenance: nlp / ai / both)
  - [ ] Idempotent re-runs: don't double-write relationships that already exist

### Phase 4 — Explore

- [x] **Relationship map visualization** — graph view of entities and edges.
  - [ ] Pick a graph rendering lib (cytoscape, d3-force, sigma, …)
  - [ ] Render nodes by entity type and edges by relationship type
  - [ ] Click a node to expand its neighborhood
  - [ ] Click an edge to see the evidence (transcript span + video deep link)
  - [ ] Filter by entity type, relationship type, or truthiness threshold

- [x] **Query** — look up an item and see its relationships and evidence.
  - [ ] Search box: free-text → entity matches (with disambiguation)
  - [ ] Entity page: list relationships grouped by type
  - [ ] Each relationship row links to its evidence + source video at the right timestamp
  - [ ] Reverse query: "what claims involve this entity in role X?"
  - [ ] CLI version of the same query for scripting

### Phase 5 — Truth

- [x] **Per-claim truthiness** — extract end-of-transcript true/false judgments and attach truthiness to the relevant relationships.
  - [ ] Detect the "summary / verdict" region at the end of transcripts
  - [ ] Extract claim-level true/false/uncertain judgments from that region
  - [ ] Map each judgment back to the relationships it refers to
  - [ ] Persist truthiness on the relationship (with the source span as evidence)
  - [ ] Tests over fixture transcripts with known summary verdicts

- [x] **Derived truthiness propagation** — propagate truth across the graph.
  - [ ] Define the propagation rule(s) (e.g. credibility of source × asserted likelihood)
  - [ ] Iterative solver that updates derived scores until stable
  - [ ] Keep direct vs. derived truthiness distinct (don't overwrite the source)
  - [ ] Re-run incrementally when new evidence arrives
  - [ ] Tests: small graphs with known expected steady-state scores

- [x] **Contradiction & loop detection** — surface conflicting truths, conflicting falsehoods, and logical loops.
  - [ ] Define what "contradiction" means at the schema level (same edge, opposite truth)
  - [ ] Detect direct contradictions across relationships
  - [ ] Detect cycles in the implication graph
  - [ ] Report with both sides + their evidence
  - [ ] Surface in the UI as a "conflicts" view

- [x] **Novel-relationship detection** — surface implicit links nobody stated outright.
  - [ ] Define "novel": pairs/groups co-present in multiple events with no asserted edge
  - [ ] Scan the graph for those candidates
  - [ ] Score by how surprising / load-bearing the implicit link looks
  - [ ] Report with the supporting co-occurrences as evidence
  - [ ] Surface in the UI as a "leads" view

### Phase 6 — Live & public

- [x] **Real-time skeptic score** — infer from a transcript whether a speaker is acting evasively / lying.
  - [ ] Define the signals (hedging language, contradictions with prior claims, evasion patterns, …)
  - [ ] Streaming scorer: consume transcript chunks and emit a rolling score
  - [ ] Cross-check claims against the existing graph in real time
  - [ ] Expose the score over a small local API for the UI to subscribe to
  - [ ] Tests with fixture streams of varying credibility

- [x] **Public read-only website** — anyone can browse the graph and follow evidence back to source video.
  - [ ] Public read-only API in front of the graph store (no mutations)
  - [ ] Public pages: search, entity, relationship, evidence with embedded video at timestamp
  - [ ] Comments and edit-requests routed to a moderated queue (never directly mutating the graph)
  - [ ] Rate limiting and abuse protection on the public surface
  - [ ] Deploy story (host, cache, build) documented in the repo

## Status

Setup / scaffolding only. No functionality implemented yet. The directory layout
below is a skeleton — modules will be filled in incrementally.

## Project structure

```
captions/
├── src/
│   ├── ingest/         # youtube transcript fetcher + rate limiter
│   ├── catalog/        # video <-> transcript catalog, gap detection
│   ├── nlp/            # entity + relationship extraction from transcripts
│   ├── ai/             # claude-code-driven enrichment pass
│   ├── graph/          # relationship graph store, queries
│   ├── truth/          # per-claim truthiness, propagation, contradiction & loop detection
│   ├── skeptic/        # real-time speaker-credibility scoring
│   ├── ui/             # navigation + graph visualization frontend
│   ├── web/            # public read-only site
│   ├── cli/            # captions CLI entrypoint
│   └── shared/         # cross-cutting types and utilities
├── tests/              # vitest tests for tools and UI
├── data/               # local transcript storage + index (gitignored)
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development

```bash
npm install
npm run build
npm test
```

Requires Node >= 20.

## Usage

End-to-end pipeline. Each step persists under `data/` so later steps pick
up where earlier ones left off.

### 1. Seed the catalog

Give it a list of YouTube ids or urls (one per line):

```ts
import { Catalog, parseIdList } from "./src/catalog/catalog.js";
import { readFileSync } from "node:fs";

const cat = new Catalog(Catalog.defaultPath());
cat.seed(parseIdList(readFileSync("videos.txt", "utf8")));
```

### 2. Fetch transcripts

Every call routes through the shared rate limiter — don't import raw
`fetch` for YouTube.

```ts
import { fetchAndStore, TranscriptFetchError } from "./src/ingest/transcript.js";
import { recordSuccess, recordFailure } from "./src/catalog/gaps.js";

for (const row of cat.all().filter((r) => r.status === "pending")) {
  try {
    const path = await fetchAndStore(row.videoId);
    recordSuccess(cat, row.videoId, path);
  } catch (e) {
    const f = (e as TranscriptFetchError).failure;
    recordFailure(cat, row.videoId, f.kind === "no-captions" ? "needs-user" : "retryable", f.kind);
  }
}
```

Print a gap report:

```ts
import { detectGaps, formatGapReport } from "./src/catalog/gaps.js";
console.log(formatGapReport(detectGaps(cat)));
```

### 3. Browse the catalog (local UI)

```ts
import { startUi } from "./src/ui/server.js";
startUi({ catalog: cat, port: 4173 });
// open http://localhost:4173
```

List view is paginated + filterable; each transcript line is a deep link
back to the source video at that timestamp.

### 4. Extract entities and relationships

```ts
import { extract } from "./src/nlp/entities.js";
import { extractRelationships } from "./src/nlp/relationships.js";
import { GraphStore } from "./src/graph/store.js";
import { readFileSync } from "node:fs";

const graph = new GraphStore(GraphStore.defaultPath());
for (const row of cat.all().filter((r) => r.status === "fetched")) {
  const transcript = JSON.parse(readFileSync(row.transcriptPath!, "utf8"));
  graph.registerTranscript(transcript.videoId);
  const entities = extract(transcript);
  for (const e of entities) graph.upsertEntity(e);
  for (const r of extractRelationships(transcript, entities)) {
    graph.upsertRelationship(r);
  }
}
```

### 5. AI enrichment (optional, batch)

Write prompt bundles, run Claude Code over them, then ingest the
responses:

```ts
import { buildBundle, writeBundles, ingestResponseFile } from "./src/ai/enrich.js";

const bundles = cat.all()
  .filter((r) => r.status === "fetched")
  .map((r) => {
    const t = JSON.parse(readFileSync(r.transcriptPath!, "utf8"));
    return buildBundle(t, graph.entities().filter((e) => e.mentions.some((m) => m.transcriptId === t.videoId)));
  });
writeBundles("data/ai/bundles", bundles);
// ... run claude code over data/ai/bundles, write responses to data/ai/responses/<id>.json ...
for (const r of cat.all().filter((x) => x.status === "fetched")) {
  const t = JSON.parse(readFileSync(r.transcriptPath!, "utf8"));
  ingestResponseFile(graph, t, `data/ai/responses/${r.videoId}.json`);
}
```

### 6. Attach truthiness and propagate

```ts
import { extractClaims, attachTruthiness } from "./src/truth/per-claim.js";
import { propagate } from "./src/truth/propagation.js";

for (const row of cat.all().filter((r) => r.status === "fetched")) {
  const t = JSON.parse(readFileSync(row.transcriptPath!, "utf8"));
  attachTruthiness(graph, t, extractClaims(t));
}
propagate(graph);
```

### 7. Query the graph

```ts
import { cliQuery } from "./src/graph/query.js";
console.log(cliQuery(graph, "merkel"));
```

Or visit an entity page in the UI at `/entity?q=merkel`.

### 8. Surface conflicts and leads

```ts
import { buildConflictReport } from "./src/truth/contradictions.js";
import { detectNovel, formatNovel } from "./src/truth/novel.js";

const { contradictions, loops } = buildConflictReport(graph);
for (const c of contradictions) console.log(c.summary);
for (const l of loops) console.log(l.summary);
for (const n of detectNovel(graph).slice(0, 10)) console.log(formatNovel(graph, n));
```

### 9. Real-time skeptic score

Stream cues through the scorer as they arrive (live transcription, a
replay, etc.):

```ts
import { SkepticScorer, startSkepticApi } from "./src/skeptic/scorer.js";

const scorer = new SkepticScorer({ store: graph });
const api = startSkepticApi(4174);
for await (const cue of liveCues) {
  const update = scorer.ingest(cue);
  api.push(update);
}
```

UI clients subscribe at `GET http://localhost:4174/skeptic/stream` (SSE).

### 10. Public read-only site

```ts
import { startPublicSite } from "./src/web/public-site.js";
startPublicSite({ store: graph, port: 8080 });
// open http://localhost:8080
```

The public surface never mutates the graph. Comments and edit-requests
land in `data/moderation/queue.jsonl` for a moderator to process. See
[src/web/DEPLOY.md](src/web/DEPLOY.md) for hosting notes.
