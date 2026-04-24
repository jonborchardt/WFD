#!/usr/bin/env tsx
// Generate sitemap.xml for the public static site.
//
// Usage:
//   tsx scripts/build-sitemap.ts [--out <path>] [--base-url <url>]
//
// Defaults:
//   --out       web/dist/sitemap.xml
//   --base-url  $SITE_BASE_URL or https://jonborchardt.github.io/WFD
//
// Run as part of the GitHub Pages deploy after data is layered into
// web/dist/. Reads data/ for the corpus.

import { resolve } from "node:path";
import { writeSitemap } from "../src/web/sitemap.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dataDir = process.env.CAPTIONS_DATA_DIR
  ? resolve(process.env.CAPTIONS_DATA_DIR)
  : resolve(process.cwd(), "data");
const baseUrl = arg("base-url") || process.env.SITE_BASE_URL || "https://jonborchardt.github.io/WFD";
const outPath = resolve(arg("out") || "web/dist/sitemap.xml");

const result = writeSitemap({ dataDir, baseUrl, outPath });
console.log(
  `sitemap: wrote ${outPath}\n` +
    `  baseUrl=${baseUrl}\n` +
    `  static=${result.counts.static} videos=${result.counts.videos} entities=${result.counts.entities} claims=${result.counts.claims} total=${result.counts.total}`,
);
