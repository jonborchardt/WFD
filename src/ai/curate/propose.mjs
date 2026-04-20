// Scan corpus + per-video entities for alias-curation proposals.
// Writes to _curate_tmp/proposals.json. See ../README.md for heuristic spec.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
const dataDir = "data";
const entDir = join(dataDir, "entities");

// ---- config ----------------------------------------------------------
const ALLOWED_LABELS = new Set([
  "person", "organization", "work_of_media", "event", "facility", "technology",
]);

// Single-token shorts that look like proper names but are English common
// nouns. Merging these to a longer form in-video is often wrong in the
// general case (e.g. "government" → "us government" changes scope).
const COMMON_NOUN_BLOCKLIST = new Set([
  // governance / military
  "government", "military", "army", "navy", "police", "congress", "president",
  "king", "queen", "minister", "senator", "officer", "officers", "general",
  "admiral", "colonel", "captain", "sergeant", "soldier", "soldiers", "agent",
  "agents", "spy", "spies",
  // people / roles
  "man", "men", "woman", "women", "boy", "girl", "child", "children", "baby",
  "people", "person", "persons", "wife", "husband", "mother", "father", "son",
  "daughter", "brother", "sister", "parent", "parents", "family", "sheriff",
  "farmer", "worker", "workers", "employee", "doctor", "pilot", "driver",
  "witnesses", "witness",
  // places / nature
  "earth", "moon", "sun", "world", "country", "city", "town", "village",
  "island", "islands", "continent", "state", "states", "county", "province",
  "room", "house", "home", "office", "building", "base", "airport", "airfield",
  "desert", "ocean", "sea", "lake", "river", "mountain", "forest", "jungle",
  "field", "hill", "coast", "shore", "valley", "park", "street", "road", "hotel",
  // orgs / institutions
  "church", "company", "corporation", "organization", "group", "team",
  "network", "news", "station", "agency", "bureau", "department", "office",
  "school", "university", "college", "hospital", "prison", "clinic",
  // events
  "war", "battle", "crash", "accident", "incident", "conspiracy", "massacre",
  "meeting", "death", "murder", "explosion", "fire", "flood", "earthquake",
  "storm", "invasion", "siege",
  // quantities
  "years", "year", "months", "month", "days", "day", "hours", "hour",
  "minutes", "minute", "seconds", "second", "thousands", "hundreds",
  "millions", "billions", "dozen", "dozens",
  // tech / objects
  "craft", "ship", "ships", "boat", "boats", "device", "devices", "machine",
  "machines", "system", "systems", "object", "objects", "vehicle", "vehicles",
]);

// ---- helpers ---------------------------------------------------------
function normalize(s) { return s.toLowerCase().trim().replace(/\s+/g, " "); }
function tokens(s) { return normalize(s).split(" ").filter(Boolean); }

function isSubseq(a, b) {
  if (a.length === 0 || a.length >= b.length) return false;
  for (let i = 0; i <= b.length - a.length; i++) {
    let ok = true;
    for (let j = 0; j < a.length; j++) {
      if (a[j] !== b[i + j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// ---- load ------------------------------------------------------------
const corpus = JSON.parse(readFileSync("_curate_tmp/corpus.json", "utf8"));
const aliases = JSON.parse(readFileSync(join(dataDir, "aliases.json"), "utf8"));

const mergedFrom = new Set(aliases.merges.map((e) => e.from));
const deleted = new Set(aliases.deletedEntities.map((e) => e.key));
const notSame = new Set(aliases.notSame.map((e) => [e.a, e.b].sort().join("~~")));
const videoMerged = new Set(aliases.videoMerges.map((e) => `${e.videoId}::${e.from}`));

const videoFiles = readdirSync(entDir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("entity-") && !f.startsWith("videos")
);

const proposals = {
  videoMerges: [],
  merges: [],
  deletedEntities: [],
  stats: {
    videos: videoFiles.length,
    considered: 0,
    videoMergeProposed: 0,
    skippedAmbiguous: 0,
    skippedLabel: 0,
    skippedTheTarget: 0,
    skippedCommonNoun: 0,
    skippedShortToken: 0,
    skippedNotSame: 0,
    skippedAlreadyHandled: 0,
  },
};

// ---- pass 1: per-video short→long merges ----------------------------
for (const f of videoFiles) {
  const vid = f.replace(/\.json$/, "");
  let j;
  try { j = JSON.parse(readFileSync(join(entDir, f), "utf8")); } catch { continue; }

  const perEntity = new Map();
  for (const m of j.mentions ?? []) {
    if (!m.label || !(m.canonical ?? m.surface)) continue;
    const canonical = m.canonical ?? m.surface;
    const norm = normalize(canonical);
    const key = `${m.label}:${norm}`;
    if (!perEntity.has(key)) perEntity.set(key, { label: m.label, canonical, norm, count: 0 });
    perEntity.get(key).count++;
    if (canonical.length > perEntity.get(key).canonical.length) {
      perEntity.get(key).canonical = canonical;
    }
  }
  const entries = [...perEntity.entries()].map(([key, v]) => ({
    key, ...v, toks: tokens(v.norm),
  }));

  for (const x of entries) {
    proposals.stats.considered++;
    if (!ALLOWED_LABELS.has(x.label)) { proposals.stats.skippedLabel++; continue; }
    if (mergedFrom.has(x.key) || deleted.has(x.key)) {
      proposals.stats.skippedAlreadyHandled++; continue;
    }
    if (videoMerged.has(`${vid}::${x.key}`)) {
      proposals.stats.skippedAlreadyHandled++; continue;
    }
    if (x.toks.length === 0 || x.toks.some((t) => t.length < 3)) {
      proposals.stats.skippedShortToken++; continue;
    }
    if (x.toks.length === 1 && COMMON_NOUN_BLOCKLIST.has(x.toks[0])) {
      proposals.stats.skippedCommonNoun++; continue;
    }
    const targets = entries.filter((y) =>
      y.label === x.label &&
      y.key !== x.key &&
      y.count >= 2 &&
      y.toks[0] !== "the" &&
      isSubseq(x.toks, y.toks)
    );
    if (targets.length === 0) continue;
    if (targets.length > 1) { proposals.stats.skippedAmbiguous++; continue; }
    const y = targets[0];
    const pair = [x.key, y.key].sort().join("~~");
    if (notSame.has(pair)) { proposals.stats.skippedNotSame++; continue; }
    if (mergedFrom.has(y.key) || deleted.has(y.key)) {
      proposals.stats.skippedAlreadyHandled++; continue;
    }
    proposals.videoMerges.push({
      videoId: vid, from: x.key, to: y.key, fromCount: x.count, toCount: y.count,
    });
    proposals.stats.videoMergeProposed++;
  }
}

// ---- pass 2: corpus-wide "the X" → "X" merges -----------------------
for (const key of Object.keys(corpus)) {
  if (mergedFrom.has(key) || deleted.has(key)) continue;
  const colon = key.indexOf(":");
  const label = key.slice(0, colon);
  const norm = key.slice(colon + 1);
  if (!norm.startsWith("the ")) continue;
  const stripped = norm.slice(4);
  const target = `${label}:${stripped}`;
  if (!Object.prototype.hasOwnProperty.call(corpus, target)) continue;
  if (mergedFrom.has(target) || deleted.has(target)) continue;
  const pair = [key, target].sort().join("~~");
  if (notSame.has(pair)) continue;
  proposals.merges.push({
    from: key, to: target,
    fromTotal: corpus[key].total, toTotal: corpus[target].total,
  });
}

// ---- pass 3: [music]-contaminated canonicals -----------------------
for (const [key, v] of Object.entries(corpus)) {
  if (mergedFrom.has(key) || deleted.has(key)) continue;
  const norm = normalize(v.canonical);
  if (norm.includes("[music]") || norm === "[music]" || /^\[.+\]$/.test(v.canonical)) {
    proposals.deletedEntities.push({
      key, canonical: v.canonical, total: v.total, videos: Object.keys(v.perVideo).length,
    });
  }
}

proposals.ms = Date.now() - t0;
writeFileSync("_curate_tmp/proposals.json", JSON.stringify(proposals, null, 2));
console.log(JSON.stringify({
  videoMerges: proposals.videoMerges.length,
  merges: proposals.merges.length,
  deletedEntities: proposals.deletedEntities.length,
  ms: proposals.ms,
  stats: proposals.stats,
}, null, 2));
