// Entry point for `npm run dev`. Serves the UI read-only against the
// default catalog. All mutations (seed load, ingest, heal, pipeline) go
// through the CLI so the dev server has no boot-time side effects.

import { Catalog } from "../catalog/catalog.js";
import { configureLogger, logger } from "../shared/logger.js";
import { startUi } from "./server.js";

configureLogger({ console: true });
logger.info("boot");

const catalog = new Catalog(Catalog.defaultPath());

const port = Number(process.env.PORT ?? 4173);
startUi({ catalog, port });
console.log(`captions ui on http://localhost:${port}`);
