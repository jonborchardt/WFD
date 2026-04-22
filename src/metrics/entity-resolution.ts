// Entity-resolution metrics (Plan 05). Reflects Plan 02 outcomes —
// first-name persons still ambiguous, gazetteer (ALWAYS_PROMOTE)
// coverage, case/title duplicates detected by the normalize pass.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../graph/aliases-schema.js";
import { ALWAYS_PROMOTE, DELETE_LABELS } from "../ai/curate/delete-always.js";
import type { Metric, MetricSection } from "./types.js";

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export const entityResolutionSection: MetricSection = {
  section: "entity-resolution",
  compute(dataDir: string): Metric[] {
    let aliases;
    try {
      aliases = readAliasesFile(dataDir);
    } catch {
      aliases = null;
    }
    const deletedKeys = new Set(aliases?.deletedEntities.map((e) => e.key) ?? []);
    const mergedFrom = new Map((aliases?.merges ?? []).map((e) => [e.from, e.to]));
    const videoMergedFrom = new Set(
      (aliases?.videoMerges ?? []).map((e) => `${e.videoId}::${e.from}`),
    );
    const deleteLabelsSet = new Set(DELETE_LABELS.map((d) => d.label));

    function resolveKey(k: string): string | null {
      if (deletedKeys.has(k)) return null;
      const label = k.slice(0, k.indexOf(":"));
      if (deleteLabelsSet.has(label)) return null;
      let cur = k, hops = 0;
      while (mergedFrom.has(cur) && hops < 10) { cur = mergedFrom.get(cur)!; hops++; }
      if (deletedKeys.has(cur)) return null;
      return cur;
    }

    // Scan corpus, track each entity's videos.
    const entDir = join(dataDir, "entities");
    const corpus = new Map<string, { label: string; canonical: string; videos: Set<string>; total: number }>();
    // Also track first-name mentions per video → resolved key for
    // the "ambiguous multi-video" count. Distinct from the corpus map
    // because we need the raw (unresolved) key when counting.
    const personByVideo = new Map<string, Set<string>>(); // rawKey -> set of videos
    if (existsSync(entDir)) {
      const files = readdirSync(entDir).filter(
        (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
      );
      for (const f of files) {
        const vid = f.replace(/\.json$/, "");
        let j: { mentions?: Array<{ label?: string; canonical?: string }> };
        try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
        for (const m of j.mentions ?? []) {
          if (!m.label || !m.canonical) continue;
          const raw = `${m.label}:${normalize(m.canonical)}`;
          const resolved = resolveKey(raw);
          if (!resolved) continue;
          if (!corpus.has(resolved)) {
            corpus.set(resolved, { label: m.label, canonical: m.canonical, videos: new Set(), total: 0 });
          }
          const row = corpus.get(resolved)!;
          row.total++;
          row.videos.add(vid);

          if (m.label === "person") {
            const rest = normalize(m.canonical);
            if (rest && !rest.includes(" ")) {
              // Single-token person — candidate for ambiguity if no
              // per-video merge has claimed it yet.
              if (!videoMergedFrom.has(`${vid}::${raw}`)) {
                if (!personByVideo.has(raw)) personByVideo.set(raw, new Set());
                personByVideo.get(raw)!.add(vid);
              }
            }
          }
        }
      }
    }

    let firstNameMultiVideo = 0;
    for (const vids of personByVideo.values()) {
      if (vids.size >= 3) firstNameMultiVideo++;
    }

    // Case/title duplicate proxy — count pairs of keys whose
    // lowercased, stripped canonical collides with another active key.
    // Cheap heuristic: group by (label, lowercased canonical).
    const groups = new Map<string, number>();
    for (const [, row] of corpus) {
      const n = normalize(row.canonical);
      const g = `${row.label}::${n}`;
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    let caseDuplicates = 0;
    for (const count of groups.values()) if (count > 1) caseDuplicates += count - 1;

    // ALWAYS_PROMOTE coverage — how many of our gazetteer entries have
    // both endpoints present in the corpus (actually applicable).
    const corpusKeys = new Set(corpus.keys());
    // Include merged-from keys too — ALWAYS_PROMOTE may have already
    // applied and moved the `from` into `to`'s cluster.
    for (const k of mergedFrom.keys()) corpusKeys.add(k);
    const gazetteerSize = ALWAYS_PROMOTE.length;
    let gazetteerActive = 0;
    for (const g of ALWAYS_PROMOTE) {
      if (corpusKeys.has(g.from) || corpusKeys.has(g.to)) gazetteerActive++;
    }

    return [
      { section: "entity-resolution", name: "resolution.gazetteerSize", value: gazetteerSize, unit: "count",
        description: "total ALWAYS_PROMOTE entries in the committed gazetteer",
        source: "src/ai/curate/delete-always.ts" },
      { section: "entity-resolution", name: "resolution.gazetteerActive", value: gazetteerActive, unit: "count",
        description: "gazetteer entries where at least one endpoint exists in the corpus",
        source: "corpus scan" },
      { section: "entity-resolution", name: "resolution.firstNamePersonsMultiVideo", value: firstNameMultiVideo, unit: "count",
        description: "single-token person entities appearing in ≥3 videos without a per-video merge (target: 0 — run Plan 2-2 Part C)",
        source: "data/entities/*.json + data/aliases.json" },
      { section: "entity-resolution", name: "resolution.caseDuplicates", value: caseDuplicates, unit: "count",
        description: "active entities that collide with a same-label neighbor after lowercase normalization (target: 0)",
        source: "corpus scan" },
    ];
  },
};
