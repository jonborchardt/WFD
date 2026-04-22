// Plan 05 §F3 — diff current per-video claim files against the gold
// slice. Exits non-zero on "material regression" (defined below) so CI
// / the operator can gate on the gold set separately from the
// corpus-wide metrics.
//
// Material regression per video:
//   - claim count dropped by more than 30% relative to gold
//   - evidence p50 chars doubled relative to gold
//   - denies count dropped to below half of gold
//   - contradicts deps dropped to below half of gold
//
// These thresholds are intentionally permissive — gold is a "smoke
// test," not a character study. For tight sample-vs-sample diffs,
// operator opens the two files directly.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dataDir = "data";
const goldRoot = join(dataDir, "gold");
const goldClaimsDir = join(goldRoot, "claims");

if (!existsSync(goldClaimsDir)) {
  console.log(JSON.stringify({ ok: true, reason: "no gold slice" }));
  process.exit(0);
}

function percentileSorted(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function summarize(claimsJson) {
  const claims = claimsJson?.claims ?? [];
  const evLens = [];
  let denies = 0;
  let contradicts = 0;
  for (const c of claims) {
    if (c.hostStance === "denies") denies++;
    for (const d of c.dependencies ?? []) {
      if (d.kind === "contradicts") contradicts++;
    }
    for (const ev of c.evidence ?? []) {
      if (typeof ev.quote === "string") evLens.push(ev.quote.length);
    }
  }
  evLens.sort((a, b) => a - b);
  return {
    claimCount: claims.length,
    evP50: percentileSorted(evLens, 0.5),
    denies,
    contradicts,
  };
}

const files = readdirSync(goldClaimsDir).filter((f) => f.endsWith(".json"));
const rows = [];
let regressions = 0;

for (const f of files) {
  const vid = f.replace(/\.json$/, "");
  const goldPath = join(goldClaimsDir, f);
  const curPath = join(dataDir, "claims", f);
  if (!existsSync(curPath)) {
    rows.push({ vid, status: "missing", reason: "current file missing" });
    regressions++;
    continue;
  }
  let gold;
  let cur;
  try {
    gold = JSON.parse(readFileSync(goldPath, "utf8"));
    cur = JSON.parse(readFileSync(curPath, "utf8"));
  } catch (e) {
    rows.push({ vid, status: "error", reason: `parse failed: ${e.message}` });
    regressions++;
    continue;
  }
  const g = summarize(gold);
  const c = summarize(cur);
  const reasons = [];
  if (c.claimCount < g.claimCount * 0.7) {
    reasons.push(`claim count ${c.claimCount} < 70% of gold ${g.claimCount}`);
  }
  if (c.evP50 > g.evP50 * 2 && g.evP50 > 0) {
    reasons.push(`evidence p50 ${c.evP50} > 2× gold ${g.evP50}`);
  }
  if (c.denies < g.denies / 2) {
    reasons.push(`denies ${c.denies} < half of gold ${g.denies}`);
  }
  if (c.contradicts < g.contradicts / 2) {
    reasons.push(`contradicts ${c.contradicts} < half of gold ${g.contradicts}`);
  }
  if (reasons.length > 0) {
    rows.push({ vid, status: "regressed", reasons, gold: g, current: c });
    regressions++;
  } else {
    rows.push({ vid, status: "ok", gold: g, current: c });
  }
}

const report = {
  ok: regressions === 0,
  checkedAt: new Date().toISOString(),
  totalVideos: rows.length,
  regressions,
  rows,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
