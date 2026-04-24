// Sitemap generator for the public static site.
//
// Reads the corpus on disk and emits an XML sitemap covering:
//   - static public routes (/, /about, /claims, /contradictions, ...)
//   - one entry per video (/video/<id>)
//   - one entry per entity in the relationships graph (/entity/<key>)
//   - one entry per claim in the corpus claims index (/claim/<id>)
//
// Run from the CLI:  captions sitemap --out web/dist/sitemap.xml
//
// `baseUrl` is the absolute origin + base path the site is served from
// (e.g. https://jonborchardt.github.io/WFD). Trailing slash optional.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface CatalogFile {
  rows: Record<string, { videoId: string; stages?: Record<string, { at?: string }> }>;
}

interface ClaimsIndexFile {
  generatedAt?: string;
  claims: Array<{ id: string }>;
}

interface RelGraphFile {
  nodes: Array<{ id: string }>;
}

const STATIC_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/",                          changefreq: "weekly",  priority: "1.0" },
  { path: "/about",                     changefreq: "monthly", priority: "0.6" },
  { path: "/videos",                    changefreq: "weekly",  priority: "0.9" },
  { path: "/claims",                    changefreq: "weekly",  priority: "0.9" },
  { path: "/contradictions",            changefreq: "weekly",  priority: "0.9" },
  { path: "/cross-video-agreements",    changefreq: "weekly",  priority: "0.8" },
  { path: "/entity-map",                changefreq: "weekly",  priority: "0.8" },
  { path: "/argument-map",              changefreq: "weekly",  priority: "0.7" },
];

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]!);
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string): string {
  const parts = [`    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

export interface BuildSitemapOptions {
  dataDir: string;
  baseUrl: string;
}

export interface BuildSitemapResult {
  xml: string;
  counts: { static: number; videos: number; entities: number; claims: number; total: number };
}

export function buildSitemap(opts: BuildSitemapOptions): BuildSitemapResult {
  const origin = opts.baseUrl.replace(/\/+$/, "");
  const url = (path: string) => `${origin}${path.startsWith("/") ? path : "/" + path}`;

  const entries: string[] = [];

  // Static routes
  for (const r of STATIC_ROUTES) {
    entries.push(urlEntry(url(r.path), undefined, r.changefreq, r.priority));
  }

  // Per-video routes — lastmod is the most recent stage timestamp for the row.
  let videoCount = 0;
  const catalogPath = join(opts.dataDir, "catalog", "catalog.json");
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
    for (const row of Object.values(catalog.rows ?? {})) {
      const stages = Object.values(row.stages ?? {});
      const lastmod = stages
        .map((s) => s?.at)
        .filter((x): x is string => typeof x === "string")
        .sort()
        .pop();
      entries.push(urlEntry(url(`/video/${row.videoId}`), lastmod, "monthly", "0.7"));
      videoCount++;
    }
  }

  // Per-entity routes — every node in the public relationships graph.
  // No lastmod: there's no per-entity update timestamp, and corpus-wide
  // timestamps would falsely flap every entity on every rebuild.
  let entityCount = 0;
  const relGraphPath = join(opts.dataDir, "graph", "relationships-graph.json");
  if (existsSync(relGraphPath)) {
    const g = JSON.parse(readFileSync(relGraphPath, "utf8")) as RelGraphFile;
    for (const node of g.nodes ?? []) {
      entries.push(urlEntry(url(`/entity/${encodeURIComponent(node.id)}`), undefined, "monthly", "0.5"));
      entityCount++;
    }
  }

  // Per-claim routes — every claim in the corpus index.
  // No lastmod: claims-index.generatedAt is corpus-wide, so stamping it
  // per-claim would lie about every claim having changed on every rebuild.
  let claimCount = 0;
  const claimsIndexPath = join(opts.dataDir, "claims", "claims-index.json");
  if (existsSync(claimsIndexPath)) {
    const ci = JSON.parse(readFileSync(claimsIndexPath, "utf8")) as ClaimsIndexFile;
    for (const c of ci.claims ?? []) {
      entries.push(urlEntry(url(`/claim/${encodeURIComponent(c.id)}`), undefined, "weekly", "0.6"));
      claimCount++;
    }
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join("\n") +
    `\n</urlset>\n`;

  return {
    xml,
    counts: {
      static: STATIC_ROUTES.length,
      videos: videoCount,
      entities: entityCount,
      claims: claimCount,
      total: STATIC_ROUTES.length + videoCount + entityCount + claimCount,
    },
  };
}

export function writeSitemap(opts: BuildSitemapOptions & { outPath: string }): BuildSitemapResult {
  const result = buildSitemap(opts);
  writeFileSync(opts.outPath, result.xml, "utf8");
  return result;
}
