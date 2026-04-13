# captions

Take a large corpus of (often contested) video, pull transcripts, and try to figure
out **what is actually true in the world** — by extracting entities, mapping their
relationships, scoring truthiness, and letting people query and trace every claim
back to the original video and timestamp.

## Goals

The end-user goal: a person logs in, looks up a topic, and gets back a relationship
map plus pointers into the source video (with time slices).

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
