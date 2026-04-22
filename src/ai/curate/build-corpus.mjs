// Build corpus entity map {label, canonical, total, perVideo} into
// _curate_tmp/corpus.json. Cheap: ~500ms for 200+ videos.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
const dataDir = "data";
const entDir = join(dataDir, "entities");

const files = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos")
);

function normalize(s) { return s.toLowerCase().trim().replace(/\s+/g, " "); }

const corpus = {};
for (const f of files) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
  for (const m of j.mentions ?? []) {
    if (!m.label || !(m.canonical ?? m.surface)) continue;
    const canonical = m.canonical ?? m.surface;
    const key = `${m.label}:${normalize(canonical)}`;
    if (!corpus[key]) corpus[key] = { label: m.label, canonical, total: 0, perVideo: {} };
    corpus[key].total++;
    corpus[key].perVideo[vid] = (corpus[key].perVideo[vid] || 0) + 1;
    if (canonical.length > corpus[key].canonical.length) corpus[key].canonical = canonical;
  }
}

if (!existsSync("_curate_tmp")) mkdirSync("_curate_tmp");
writeFileSync("_curate_tmp/corpus.json", JSON.stringify(corpus, null, 2));

console.log(JSON.stringify({
  videos: files.length,
  entities: Object.keys(corpus).length,
  mentions: Object.values(corpus).reduce((s, e) => s + e.total, 0),
  ms: Date.now() - t0,
}));
