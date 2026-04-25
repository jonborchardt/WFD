#!/usr/bin/env node
// audit-claims-bar.mjs
//
// Walks every per-video data/claims/<id>.json, computes a v2 quality
// fingerprint (evidence-length percentiles, hostStance histogram, typed
// contradicts prefix histogram, dep coverage, claims-per-video distribution,
// directTruth set rate, inVerdictSection rate, atomicity heuristic), and
// writes data/claims/_v2-fingerprint.json. Also prints a grouped summary
// to stdout.
//
// Used by:
//   - the v2 recovery plan (2026-04-24-v2-recovery-and-drift-prevention.md)
//     to reconstruct the empirical bar after the prompt-of-record was lost
//   - future drift checks to confirm the corpus is still v2-shaped
//
// No deps; pure node:fs.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLAIMS_DIR = join(REPO_ROOT, "data", "claims");
const OUT_PATH = join(CLAIMS_DIR, "_v2-fingerprint.json");

const RESERVED = new Set([
  "claims-index.json",
  "dependency-graph.json",
  "contradictions.json",
  "edge-truth.json",
  "embeddings.json",
  "contradiction-verdicts.json",
  "consonance.json",
  "_v2-fingerprint.json",
]);

const TYPED_PREFIX_RE = /^\s*\[(logical|debunks|alternative|undercuts)\]\s*/i;
// Compound thesis heuristic: "X and Y" / "X, and Y" / "X; Y" with two
// independent verb phrases. We use a coarse signal — number of finite verbs
// (per a small marker set) on either side of " and " — well enough for a
// percentage. False positives are fine; the metric is direction-of-travel.
const COMPOUND_AND_RE = /\b(?:and|;)\s+/i;
const VERB_MARKERS_RE = /\b(?:is|are|was|were|has|have|had|will|would|can|could|may|might|did|does|do|said|says|claims?|argued|believes?|asserts?|denied|denies)\b/gi;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function avg(xs) {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
}

function pct(n, d) {
  if (d === 0) return 0;
  return Math.round((n / d) * 10000) / 100;
}

function isLikelyCompound(text) {
  if (typeof text !== "string") return false;
  const parts = text.split(COMPOUND_AND_RE);
  if (parts.length < 2) return false;
  // Both sides need a verb marker for the "two independent clauses" heuristic.
  let withVerb = 0;
  for (const p of parts) {
    if (VERB_MARKERS_RE.test(p)) withVerb++;
    VERB_MARKERS_RE.lastIndex = 0;
  }
  return withVerb >= 2;
}

function dayOf(iso) {
  if (typeof iso !== "string") return "unknown";
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(iso);
  return m ? m[1] : "unknown";
}

function loadClaimFiles() {
  const files = readdirSync(CLAIMS_DIR)
    .filter((f) => f.endsWith(".json") && !RESERVED.has(f));
  const out = [];
  for (const f of files) {
    const path = join(CLAIMS_DIR, f);
    try {
      const j = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(j.claims)) {
        out.push({ file: f, payload: j, mtime: statSync(path).mtimeMs });
      }
    } catch {
      // skip unparseable
    }
  }
  return out;
}

function main() {
  const files = loadClaimFiles();
  const fileCount = files.length;

  let totalClaims = 0;
  let withDirectTruth = 0;
  let withInVerdictSection = 0;
  let likelyCompound = 0;

  const evidenceLengths = [];
  const claimsPerVideo = [];
  const stanceHist = { asserts: 0, denies: 0, uncertain: 0, steelman: 0, unset: 0 };
  const kindHist = { empirical: 0, historical: 0, speculative: 0, opinion: 0, definitional: 0 };
  const subkindHist = { logical: 0, debunks: 0, alternative: 0, undercuts: 0, untyped: 0 };
  const depKindHist = { supports: 0, contradicts: 0, presupposes: 0, elaborates: 0 };
  let claimsWithDeps = 0;
  let totalContradicts = 0;
  let typedContradicts = 0;
  const generatorHist = {};
  const dayHist = {};            // generatedAt day -> file count
  const dayP50 = {};              // generatedAt day -> evidence p50 (per-file avg of medians)
  const dayDenies = {};           // generatedAt day -> {denies, total}

  for (const { payload } of files) {
    const day = dayOf(payload.generatedAt);
    dayHist[day] = (dayHist[day] ?? 0) + 1;
    generatorHist[payload.generator ?? "unknown"] = (generatorHist[payload.generator ?? "unknown"] ?? 0) + 1;
    claimsPerVideo.push(payload.claims.length);

    const fileEvLens = [];
    let fileDenies = 0;
    for (const c of payload.claims) {
      totalClaims++;
      if (c.directTruth !== undefined) withDirectTruth++;
      if (c.inVerdictSection === true) withInVerdictSection++;
      if (isLikelyCompound(c.text)) likelyCompound++;
      const stance = c.hostStance ?? "unset";
      if (stanceHist[stance] !== undefined) stanceHist[stance]++;
      else stanceHist.unset++;
      if (c.hostStance === "denies") fileDenies++;
      if (kindHist[c.kind] !== undefined) kindHist[c.kind]++;

      const deps = Array.isArray(c.dependencies) ? c.dependencies : [];
      if (deps.length > 0) claimsWithDeps++;
      for (const d of deps) {
        if (depKindHist[d.kind] !== undefined) depKindHist[d.kind]++;
        if (d.kind === "contradicts") {
          totalContradicts++;
          const m = TYPED_PREFIX_RE.exec(d.rationale ?? "");
          if (m) {
            typedContradicts++;
            const tag = m[1].toLowerCase();
            if (subkindHist[tag] !== undefined) subkindHist[tag]++;
          } else {
            subkindHist.untyped++;
          }
        }
      }
      for (const ev of c.evidence ?? []) {
        if (typeof ev.quote === "string") {
          evidenceLengths.push(ev.quote.length);
          fileEvLens.push(ev.quote.length);
        }
      }
    }

    if (fileEvLens.length > 0) {
      fileEvLens.sort((a, b) => a - b);
      const p50 = percentile(fileEvLens, 0.5);
      if (!dayP50[day]) dayP50[day] = [];
      dayP50[day].push(p50);
    }
    if (!dayDenies[day]) dayDenies[day] = { denies: 0, total: 0 };
    dayDenies[day].denies += fileDenies;
    dayDenies[day].total += payload.claims.length;
  }

  evidenceLengths.sort((a, b) => a - b);
  claimsPerVideo.sort((a, b) => a - b);

  const fingerprint = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    corpus: {
      claimFiles: fileCount,
      totalClaims,
    },
    evidenceLength: {
      p25: percentile(evidenceLengths, 0.25),
      p50: percentile(evidenceLengths, 0.5),
      p75: percentile(evidenceLengths, 0.75),
      p90: percentile(evidenceLengths, 0.9),
      p99: percentile(evidenceLengths, 0.99),
      max: evidenceLengths[evidenceLengths.length - 1] ?? 0,
      mean: avg(evidenceLengths),
      // V2 prompt rule: "60-150 chars target, hard ceiling 300".
      targetMin: 60,
      targetMax: 150,
      hardMax: 300,
      pctInTargetRange: pct(
        evidenceLengths.filter((x) => x >= 60 && x <= 150).length,
        evidenceLengths.length,
      ),
      pctOverHardMax: pct(
        evidenceLengths.filter((x) => x > 300).length,
        evidenceLengths.length,
      ),
    },
    claimsPerVideo: {
      p25: percentile(claimsPerVideo, 0.25),
      p50: percentile(claimsPerVideo, 0.5),
      p75: percentile(claimsPerVideo, 0.75),
      p90: percentile(claimsPerVideo, 0.9),
      mean: avg(claimsPerVideo),
      min: claimsPerVideo[0] ?? 0,
      max: claimsPerVideo[claimsPerVideo.length - 1] ?? 0,
    },
    hostStance: {
      ...stanceHist,
      deniesPct: pct(stanceHist.denies, totalClaims),
      // V2 rule: "≥5%". Below this is a regression signal.
      targetDeniesMinPct: 5,
    },
    kind: kindHist,
    dependencies: {
      coveragePct: pct(claimsWithDeps, totalClaims),
      targetCoverageMinPct: 55,
      claimsWithDeps,
      kindHist: depKindHist,
      contradicts: {
        total: totalContradicts,
        typed: typedContradicts,
        typedPct: pct(typedContradicts, Math.max(1, totalContradicts)),
        subkindHist,
        // V2 rule: every contradicts dep should carry a typed prefix.
        targetTypedMinPct: 95,
      },
    },
    directTruth: {
      setCount: withDirectTruth,
      setPct: pct(withDirectTruth, totalClaims),
      // V2 rule: omit when no real basis; never default 0.5.
      // No fixed target — corpus drift signal only.
    },
    inVerdictSection: {
      setCount: withInVerdictSection,
      setPct: pct(withInVerdictSection, totalClaims),
    },
    atomicity: {
      // Heuristic only — see isLikelyCompound. Direction-of-travel signal.
      likelyCompoundCount: likelyCompound,
      likelyCompoundPct: pct(likelyCompound, totalClaims),
    },
    generatorHist,
    perDay: Object.fromEntries(
      Object.entries(dayHist).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => [
        day,
        {
          files: count,
          evP50AvgChars: avg(dayP50[day] ?? []),
          deniesPct: pct(dayDenies[day]?.denies ?? 0, dayDenies[day]?.total ?? 0),
        },
      ]),
    ),
  };

  writeFileSync(OUT_PATH, JSON.stringify(fingerprint, null, 2) + "\n", "utf8");

  // Stdout summary
  const ev = fingerprint.evidenceLength;
  const stance = fingerprint.hostStance;
  const dep = fingerprint.dependencies;
  console.log(`audit-claims-bar — wrote ${OUT_PATH}`);
  console.log(`  corpus: ${fingerprint.corpus.claimFiles} files, ${fingerprint.corpus.totalClaims} claims`);
  console.log(`  evidence length p25/p50/p75/p90/p99/max: ${ev.p25}/${ev.p50}/${ev.p75}/${ev.p90}/${ev.p99}/${ev.max}`);
  console.log(`    in v2 target range [60,150]: ${ev.pctInTargetRange}% · over hard max 300: ${ev.pctOverHardMax}%`);
  console.log(`  claims/video p25/p50/p75/p90: ${fingerprint.claimsPerVideo.p25}/${fingerprint.claimsPerVideo.p50}/${fingerprint.claimsPerVideo.p75}/${fingerprint.claimsPerVideo.p90}`);
  console.log(`  hostStance: asserts=${stance.asserts} denies=${stance.denies} uncertain=${stance.uncertain} steelman=${stance.steelman} unset=${stance.unset} (denies ${stance.deniesPct}%)`);
  console.log(`  dep coverage: ${dep.coveragePct}% (${dep.claimsWithDeps}/${fingerprint.corpus.totalClaims})`);
  console.log(`  contradicts typed: ${dep.contradicts.typedPct}% (${dep.contradicts.typed}/${dep.contradicts.total})`);
  console.log(`    subkinds: logical=${dep.contradicts.subkindHist.logical} debunks=${dep.contradicts.subkindHist.debunks} alternative=${dep.contradicts.subkindHist.alternative} undercuts=${dep.contradicts.subkindHist.undercuts} untyped=${dep.contradicts.subkindHist.untyped}`);
  console.log(`  directTruth set: ${fingerprint.directTruth.setPct}% · inVerdictSection: ${fingerprint.inVerdictSection.setPct}%`);
  console.log(`  atomicity (compound-text heuristic): ${fingerprint.atomicity.likelyCompoundPct}%`);
  console.log(`  generators: ${Object.entries(generatorHist).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  per-day:`);
  for (const [day, info] of Object.entries(fingerprint.perDay)) {
    console.log(`    ${day}: ${info.files} files · evP50 avg ${info.evP50AvgChars} chars · denies ${info.deniesPct}%`);
  }
}

main();
