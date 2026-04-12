// Entry point for `npm run ui`. Opens the default catalog and starts the
// local navigation UI. Port can be overridden with PORT=.

import { Catalog } from "../catalog/catalog.js";
import { startUi } from "./server.js";

const catalog = new Catalog(Catalog.defaultPath());
const port = Number(process.env.PORT ?? 4173);
startUi({ catalog, port });
console.log(`captions ui on http://localhost:${port}`);
