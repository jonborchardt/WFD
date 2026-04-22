// Entity-hygiene metrics.
//
// Reads aliases.json + the corpus entity scan to surface the signals
// the entity-hygiene program cares about: how many entities deleted,
// how many merged, how many role-noun persons or tautologies still
// leak through.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../graph/aliases-schema.js";
import { DELETE_ALWAYS, DELETE_LABELS } from "../ai/curate/delete-always.js";
import type { Metric, MetricSection } from "./types.js";

// Single-token "person:X" where X is one of these is a role noun, not a
// person. Mirrors (but is narrower than) the DELETE_ALWAYS personal-noun
// list — here we just track whether any are still *active* in the graph
// (i.e. not in deletedEntities or merged away).
const ROLE_NOUN_PERSONS = new Set([
  "scientists", "scientist", "researchers", "researcher",
  "witnesses", "witness", "officers", "officer",
  "astronauts", "astronaut", "farmer", "farmers", "sheriff",
  "priest", "captain", "colonel", "general", "admiral",
  "king", "queen", "pope", "doctor", "pilot", "driver",
  "worker", "workers", "employee", "agent", "agents",
  "spy", "spies", "soldier", "soldiers",
  "people", "person", "persons", "man", "men", "woman", "women",
  "boy", "girl", "children", "child", "baby", "human", "humans",
  "family", "wife", "husband", "mother", "father", "son",
  "daughter", "brother", "sister", "parent", "parents",
]);

// Tautological entity canonicals that should never exist in the active graph.
const TAUTOLOGIES = new Set(["technology:technology", "technology:tech"]);

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

interface CorpusRow {
  key: string;
  label: string;
  canonical: string;
  total: number;
  videos: Set<string>;
}

function scanCorpus(dataDir: string): Map<string, CorpusRow> {
  const out = new Map<string, CorpusRow>();
  const entDir = join(dataDir, "entities");
  if (!existsSync(entDir)) return out;
  const files = readdirSync(entDir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos"),
  );
  for (const f of files) {
    const vid = f.replace(/\.json$/, "");
    let j: { mentions?: Array<{ label?: string; canonical?: string }> };
    try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }
    for (const m of j.mentions ?? []) {
      if (!m.label || !m.canonical) continue;
      const key = `${m.label}:${normalize(m.canonical)}`;
      if (!out.has(key)) {
        out.set(key, { key, label: m.label, canonical: m.canonical, total: 0, videos: new Set() });
      }
      const row = out.get(key)!;
      row.total++;
      row.videos.add(vid);
    }
  }
  return out;
}

export const entityHygieneSection: MetricSection = {
  section: "entity-hygiene",
  compute(dataDir: string): Metric[] {
    const corpus = scanCorpus(dataDir);
    let aliases;
    try {
      aliases = readAliasesFile(dataDir);
    } catch {
      aliases = null;
    }
    const deletedKeys = new Set(aliases?.deletedEntities.map((e) => e.key) ?? []);
    const mergedFrom = new Set(aliases?.merges.map((e) => e.from) ?? []);
    const videoMerges = aliases?.videoMerges.length ?? 0;
    const deleteLabelsSet = new Set(DELETE_LABELS.map((d) => d.label));

    // "Active" means: exists in corpus AND not deleted AND not merged-away.
    // We count only keys whose label is not in DELETE_LABELS (those are
    // folded in the indexes stage and shouldn't be counted as active).
    let activeCount = 0;
    let roleNounsActive = 0;
    let tautologiesActive = 0;
    for (const [key, row] of corpus) {
      if (deleteLabelsSet.has(row.label)) continue;
      if (deletedKeys.has(key)) continue;
      if (mergedFrom.has(key)) continue;
      activeCount++;
      if (row.label === "person") {
        const rest = key.slice("person:".length);
        if (!rest.includes(" ") && ROLE_NOUN_PERSONS.has(rest)) {
          roleNounsActive++;
        }
      }
      if (TAUTOLOGIES.has(key)) tautologiesActive++;
    }

    const staticListSize = DELETE_ALWAYS.length;
    const deletedCount = aliases?.deletedEntities.length ?? 0;
    const mergesCount = aliases?.merges.length ?? 0;

    const out: Metric[] = [
      { section: "entity-hygiene", name: "entities.total", value: corpus.size, unit: "count",
        description: "unique entity keys observed across all videos (pre-alias resolution)",
        source: "data/entities/*.json" },
      { section: "entity-hygiene", name: "entities.active", value: activeCount, unit: "count",
        description: "entities still visible in the graph after aliases + DELETE_LABELS resolution",
        source: "data/entities/*.json + data/aliases.json" },
      { section: "entity-hygiene", name: "entities.deleted", value: deletedCount, unit: "count",
        description: "entries in aliases.deletedEntities",
        source: "data/aliases.json" },
      { section: "entity-hygiene", name: "entities.merged", value: mergesCount, unit: "count",
        description: "corpus-wide merges in aliases.merges",
        source: "data/aliases.json" },
      { section: "entity-hygiene", name: "entities.perVideoMerged", value: videoMerges, unit: "count",
        description: "per-video merges in aliases.videoMerges",
        source: "data/aliases.json" },
      { section: "entity-hygiene", name: "entities.roleNounPersons", value: roleNounsActive, unit: "count",
        description: "single-token person: entries matching the role-noun blocklist that are still active (target: 0)",
        source: "data/entities/*.json + data/aliases.json" },
      { section: "entity-hygiene", name: "entities.tautologies", value: tautologiesActive, unit: "count",
        description: "tautological entities still active (technology:technology, etc.)",
        source: "data/entities/*.json + data/aliases.json" },
      { section: "entity-hygiene", name: "entities.deleteAlwaysListSize", value: staticListSize, unit: "count",
        description: "size of the committed DELETE_ALWAYS list",
        source: "src/ai/curate/delete-always.ts" },
    ];
    return out;
  },
};
