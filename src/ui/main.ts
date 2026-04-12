// Entry point for `npm run dev`. Loads the seed file, boots the background
// ingester, and serves the SPA against the default catalog.

import { Catalog } from "../catalog/catalog.js";
import { loadSeedFile } from "../catalog/seed-loader.js";
import { Ingester } from "../ingest/ingester.js";
import { startUi } from "./server.js";

const catalog = new Catalog(Catalog.defaultPath());

const seed = loadSeedFile(catalog);
if (seed.exists) {
  console.log(`seed: ${seed.parsed} entries, ${seed.added} new`);
} else {
  console.log(`seed: no file at ${seed.path} (create it to auto-ingest)`);
}

const ingester = new Ingester({ catalog });
// Kick off an initial run in the background. Any new rows the seed loader
// added will flow through here; already-fetched rows are skipped.
void ingester.start();

const port = Number(process.env.PORT ?? 4173);
startUi({ catalog, ingester, port });
console.log(`captions ui on http://localhost:${port}`);
