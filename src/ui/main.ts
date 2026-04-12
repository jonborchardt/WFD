// Entry point for `npm run dev`. Loads the seed file, boots the background
// ingester, and serves the SPA against the default catalog.

import { Catalog } from "../catalog/catalog.js";
import { loadSeedFile } from "../catalog/seed-loader.js";
import { Ingester } from "../ingest/ingester.js";
import { MetaBackfiller } from "../ingest/backfill-meta.js";
import { configureLogger, logger } from "../shared/logger.js";
import { startUi } from "./server.js";

configureLogger({ console: true });
logger.info("boot");

const catalog = new Catalog(Catalog.defaultPath());

const seed = loadSeedFile(catalog);
if (seed.exists) {
  logger.info("seed.loaded", { parsed: seed.parsed, added: seed.added, path: seed.path });
} else {
  logger.info("seed.missing", { path: seed.path });
}

// On every dev boot, reset rows parked in any failed state so the ingester
// picks them up again. Genuine "no captions exist" rows will reclassify
// themselves on the next run; this just avoids manual JSON surgery when a
// classification bug has parked something by mistake.
const resetCount = catalog.resetFailed();
if (resetCount > 0) logger.info("boot.reset-failed", { count: resetCount });

const ingester = new Ingester({ catalog });
// Kick off an initial run in the background. Any new rows the seed loader
// added will flow through here; already-fetched rows are skipped.
void ingester.start();

// Backfill metadata on rows that were fetched before we started collecting
// the microformat block. Non-blocking.
const backfiller = new MetaBackfiller(catalog);
void backfiller.start();

const port = Number(process.env.PORT ?? 4173);
startUi({ catalog, ingester, port });
console.log(`captions ui on http://localhost:${port}`);
