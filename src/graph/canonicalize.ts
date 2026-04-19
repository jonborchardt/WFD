// Cross-transcript entity canonicalization.
//
// The on-disk file (data/aliases.json) is structured per
// src/graph/aliases-schema.ts (v2). This module keeps a flat
// `AliasMap` (Record<string,string>) as the runtime representation so
// the hot-path helpers (resolveKey, isDeleted, etc.) stay fast and
// simple. `readAliases` loads the structured file and compiles the
// flat map; `writeAliases` is deprecated — callers should use the
// typed mutators from aliases-schema.ts directly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistedEntities } from "../entities/index.js";
import {
  buildAliasMap,
  readAliasesFile,
  writeAliasesFile,
  migrateFromFlat,
  aliasesPath as schemaAliasesPath,
} from "./aliases-schema.js";

export interface CorpusEntity {
  key: string;
  label: string;
  canonical: string;
  totalMentions: number;
  videoIds: Set<string>;
}

export interface MergeCluster {
  canonicalKey: string;
  canonicalForm: string;
  label: string;
  members: string[];
  memberForms: string[];
  totalCooccurrences: number;
  reason: string;
  // Set after resolveAliases: "pending" | "resolved" | "dismissed"
  status?: "pending" | "resolved" | "dismissed";
}

export type AliasMap = Record<string, string>;

// Sentinel values stored in the flat runtime AliasMap. These never
// appear in the on-disk v2 file — they're internal only, compiled by
// buildAliasMap() from the structured entries.
const NOT_SAME = "__not_same__";
const DISMISSED = "__dismissed__";
const DELETED = "__deleted__";

export function isSentinel(v: string): boolean {
  return (
    v === NOT_SAME ||
    v === DISMISSED ||
    v === DELETED ||
    // Legacy flat-format sentinels. Still accepted so in-flight data
    // from before the migration doesn't trip helpers.
    v === "__hidden__" ||
    v === "__rejected__"
  );
}

// True if the entity (or any entity it merges into) has been deleted
// by the operator. "Delete" and "hide" used to be separate concepts;
// they're now one — a deleted entity is dropped from the graph and
// any relationship touching it is dropped too.
export function isDeleted(key: string, aliases: AliasMap): boolean {
  const resolved = resolveKey(key, aliases);
  const v = aliases[resolved];
  return v === DELETED || v === "__hidden__";
}

export const SENTINEL_DELETED = DELETED;
export const SENTINEL_NOT_SAME = NOT_SAME;
export const SENTINEL_DISMISSED = DISMISSED;

// Key for a "not same" pair. Always sorted so A~~B === B~~A.
export function notSameKey(a: string, b: string): string {
  return a < b ? `${a}~~${b}` : `${b}~~${a}`;
}

// Prefix helpers for the extended alias-map key types. All three live
// in the same flat aliases.json so AI can emit them one line at a
// time; the prefixes disambiguate.
//
//   display:<entityKey>              → "Custom Display Name"
//   video:<videoId>:<entityKey>      → targetEntityKey  (per-video merge)
//   del:<videoId>:<compositeRelKey>  → "true"           (per-video rel delete)

export function displayKey(entityKey: string): string {
  return `display:${entityKey}`;
}

export function videoAliasKey(videoId: string, fromKey: string): string {
  return `video:${videoId}:${fromKey}`;
}

export function deletedRelationKey(
  videoId: string,
  subjectKey: string,
  predicate: string,
  objectKey: string,
  timeStart: number,
): string {
  return `del:${videoId}:${subjectKey}|${predicate}|${objectKey}|${Math.floor(timeStart)}`;
}

export function getDisplayOverride(
  entityKey: string,
  aliases: AliasMap,
): string | undefined {
  const v = aliases[displayKey(entityKey)];
  return v && !isSentinel(v) ? v : undefined;
}

export function getVideoAlias(
  videoId: string,
  fromKey: string,
  aliases: AliasMap,
): string | undefined {
  const v = aliases[videoAliasKey(videoId, fromKey)];
  return v && !isSentinel(v) ? v : undefined;
}

export function isRelationDeleted(
  videoId: string,
  subjectKey: string,
  predicate: string,
  objectKey: string,
  timeStart: number,
  aliases: AliasMap,
): boolean {
  return (
    aliases[deletedRelationKey(videoId, subjectKey, predicate, objectKey, timeStart)] ===
    "true"
  );
}

export function aliasesPath(dataDir: string): string {
  return schemaAliasesPath(dataDir);
}

// Load the structured v2 aliases file and compile the flat runtime
// AliasMap that the hot-path helpers below consume. Transparently
// migrates v1 flat files on first read (writes the v2 form back).
export function readAliases(dataDir: string): AliasMap {
  const file = readAliasesFile(dataDir);
  return buildAliasMap(file);
}

// Deprecated compatibility shim. The old flat format is being phased
// out; callers that need to mutate the file should use the typed
// helpers from src/graph/aliases-schema.ts (addMerge, addDeletedEntity,
// addDisplay, etc.) so sections stay well-formed.
//
// When this shim is called we reconstruct a v2 file from the flat
// Map and write it. That path exists because some tests and the
// cluster-review POST path still mutate the flat Map directly.
export function writeAliases(dataDir: string, flat: AliasMap): void {
  const file = migrateFromFlat(flat);
  writeAliasesFile(dataDir, file);
}

// Canonical normalization used by both the corpus builder (this file)
// and the graph adapter (src/graph/adapt.ts) so every entity key is
// computed the same way regardless of which module generates it.
export function normalizeCanonical(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Build the full entity key (label + ":" + normalized canonical) used
// everywhere as an entity's stable identifier.
export function entityKeyOf(label: string, canonical: string): string {
  return `${label}:${normalizeCanonical(canonical)}`;
}

function normalize(s: string): string {
  return normalizeCanonical(s);
}

const NO_SUBSTRING_LABELS = new Set(["date_time", "quantity"]);

export function buildCorpusEntities(dataDir: string): Map<string, CorpusEntity> {
  const entitiesDir = join(dataDir, "entities");
  if (!existsSync(entitiesDir)) return new Map();
  const corpus = new Map<string, CorpusEntity>();
  const files = readdirSync(entitiesDir).filter(
    (f) => f.endsWith(".json") && !f.includes("entity-"),
  );
  for (const file of files) {
    try {
      const raw = JSON.parse(
        readFileSync(join(entitiesDir, file), "utf8"),
      ) as PersistedEntities;
      const vid = raw.transcriptId;
      for (const m of raw.mentions) {
        const key = `${m.label}:${normalize(m.canonical)}`;
        const existing = corpus.get(key);
        if (existing) {
          existing.totalMentions++;
          existing.videoIds.add(vid);
          if (m.canonical.length > existing.canonical.length) {
            existing.canonical = m.canonical;
          }
        } else {
          corpus.set(key, {
            key,
            label: m.label,
            canonical: m.canonical,
            totalMentions: 1,
            videoIds: new Set([vid]),
          });
        }
      }
    } catch {
      continue;
    }
  }
  return corpus;
}

// Union-Find for transitive clustering.
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  clusters(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const arr = groups.get(root) ?? [];
      arr.push(key);
      groups.set(root, arr);
    }
    return groups;
  }
}

// Check if two entities are marked as "not same" in the aliases.
function areNotSame(a: string, b: string, aliases: AliasMap): boolean {
  return aliases[notSameKey(a, b)] === NOT_SAME;
}

// Build transitive merge clusters, respecting "not same" constraints.
// Pairs marked as not-same will not be union'd.
export function buildMergeClusters(
  corpus: Map<string, CorpusEntity>,
  aliases: AliasMap = {},
): MergeCluster[] {
  const uf = new UnionFind();
  const cooccurrences = new Map<string, number>();

  const byLabel = new Map<string, CorpusEntity[]>();
  for (const e of corpus.values()) {
    if (NO_SUBSTRING_LABELS.has(e.label)) continue;
    const arr = byLabel.get(e.label) ?? [];
    arr.push(e);
    byLabel.set(e.label, arr);
  }

  for (const [, entries] of byLabel) {
    const sorted = entries
      .slice()
      .sort((a, b) => b.canonical.length - a.canonical.length);
    for (let i = 0; i < sorted.length; i++) {
      const longer = sorted[i];
      const longerNorm = normalize(longer.canonical);
      for (let j = i + 1; j < sorted.length; j++) {
        const shorter = sorted[j];
        const shorterNorm = normalize(shorter.canonical);
        if (shorterNorm.length <= 2) continue;
        if (!longerNorm.includes(shorterNorm)) continue;
        // Skip pairs the operator marked as "not same".
        if (areNotSame(shorter.key, longer.key, aliases)) continue;
        let cooc = 0;
        for (const vid of shorter.videoIds) {
          if (longer.videoIds.has(vid)) cooc++;
        }
        if (cooc === 0) continue;
        uf.union(shorter.key, longer.key);
        const pairKey = [shorter.key, longer.key].sort().join("|");
        cooccurrences.set(pairKey, (cooccurrences.get(pairKey) ?? 0) + cooc);
      }
    }
  }

  const rawClusters = uf.clusters();
  const result: MergeCluster[] = [];
  for (const members of rawClusters.values()) {
    if (members.length < 2) continue;
    let best = members[0];
    let bestLen = corpus.get(best)?.canonical.length ?? 0;
    for (const m of members) {
      const len = corpus.get(m)?.canonical.length ?? 0;
      if (len > bestLen) {
        best = m;
        bestLen = len;
      }
    }
    const bestEntity = corpus.get(best)!;
    let totalCooc = 0;
    for (const [pairKey, count] of cooccurrences) {
      const [a, b] = pairKey.split("|");
      if (members.includes(a) && members.includes(b)) {
        totalCooc += count;
      }
    }
    result.push({
      canonicalKey: best,
      canonicalForm: bestEntity.canonical,
      label: bestEntity.label,
      members,
      memberForms: members.map((m) => corpus.get(m)?.canonical ?? m),
      totalCooccurrences: totalCooc,
      reason: "substring",
    });
  }
  return result.sort((a, b) => b.totalCooccurrences - a.totalCooccurrences);
}

export function clusterIdentity(members: string[]): string {
  return members.slice().sort().join("||");
}

// Classify each cluster as pending, resolved, or dismissed.
// A cluster is "resolved" when every non-canonical member has EITHER
// an alias entry (same) or a not-same entry against the canonical.
export function classifyClusters(
  clusters: MergeCluster[],
  aliases: AliasMap,
): MergeCluster[] {
  return clusters.map((c) => {
    const cid = clusterIdentity(c.members);
    if (isSentinel(aliases[cid] ?? "")) {
      return { ...c, status: "dismissed" as const };
    }
    const allResolved = c.members.every((m) => {
      if (m === c.canonicalKey) return true;
      // Has a merge alias?
      if (aliases[m] !== undefined && !isSentinel(aliases[m])) return true;
      // Has a "not same" entry against the canonical?
      if (aliases[notSameKey(m, c.canonicalKey)] === NOT_SAME) return true;
      return false;
    });
    return { ...c, status: allResolved ? "resolved" as const : "pending" as const };
  });
}

// Resolve a single entity key through the alias chain.
export function resolveKey(key: string, aliases: AliasMap): string {
  let resolved = key;
  for (let i = 0; i < 10; i++) {
    const next = aliases[resolved];
    if (!next || isSentinel(next) || next === resolved) break;
    resolved = next;
  }
  return resolved;
}

// Record a review decision: checked members merge, unchecked get
// "not same" entries against the canonical.
export function recordReview(
  aliases: AliasMap,
  canonical: string,
  checked: string[],
  allMembers: string[],
): void {
  const checkedSet = new Set(checked);
  for (const m of allMembers) {
    if (m === canonical) continue;
    if (checkedSet.has(m)) {
      aliases[m] = canonical;
    } else {
      aliases[notSameKey(m, canonical)] = NOT_SAME;
    }
  }
}
