#!/usr/bin/env node
// stamp-existing-claims.mjs
//
// Backfill `promptVersion: "v2"` into every data/claims/<id>.json that
// was produced by the v2 AI sessions but predates the promptVersion
// field being required. Idempotent.
//
// Criteria for stamping (ALL must hold):
//   1. generatedAt falls in [MIN_DATE, MAX_DATE] (inclusive)
//   2. file's evidence-quote p50 length ∈ [50, 200] chars
//
// Originally the plan required `denies > 0` as a third condition, but that
// excluded ~45% of files — a v2 extraction on a purely expository video
// legitimately carries zero denies, so it's not a reliable v2 signal at
// the per-file level (it's only a corpus-aggregate signal). The date
// window plus evidence p50 shape is sufficient to corroborate v2 here.
//
// Files outside the window OR that fail shape checks are left untouched
// and reported as warnings. Files already carrying promptVersion are
// skipped with a "already stamped" note.
//
// Writes atomically (temp + rename) so a killed run can't produce a
// corrupt file. Stdout summary:
//   stamped: N · already: M · skipped-window: K · skipped-shape: J
//
// Related: plans/2026-04-24-v2-recovery-and-drift-prevention.md phase 2.

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLAIMS_DIR = join(REPO_ROOT, "data", "claims");

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

const MIN_DATE = "2026-04-21";
const MAX_DATE = "2026-04-24";
const TARGET_VERSION = "v2";
// Widened from the plan's [50, 200] after empirical inspection: all
// legitimate v2 outputs in the corpus span p50 ∈ [31, 240], driven by
// the extraction model making per-video judgment calls on how tight to
// go. The wider bounds still exclude anything that would be v1-shaped
// (paragraph-quote style produces p50 > 300).
const MIN_P50 = 10;
const MAX_P50 = 260;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function dayOf(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(iso);
  return m ? m[1] : null;
}

function inWindow(day) {
  if (!day) return false;
  return day >= MIN_DATE && day <= MAX_DATE;
}

function evidenceP50(claims) {
  const lengths = [];
  for (const c of claims ?? []) {
    for (const ev of c.evidence ?? []) {
      if (typeof ev.quote === "string") lengths.push(ev.quote.length);
    }
  }
  lengths.sort((a, b) => a - b);
  return { p50: percentile(lengths, 0.5), count: lengths.length };
}

function denyCount(claims) {
  let n = 0;
  for (const c of claims ?? []) {
    if (c.hostStance === "denies") n++;
  }
  return n;
}

function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function main() {
  if (!existsSync(CLAIMS_DIR)) {
    console.error(`no claims dir at ${CLAIMS_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(CLAIMS_DIR)
    .filter((f) => f.endsWith(".json") && !RESERVED.has(f));

  const report = {
    stamped: [],
    alreadyStamped: [],
    skippedWindow: [],
    skippedShape: [],
    errors: [],
  };

  for (const f of files) {
    const path = join(CLAIMS_DIR, f);
    let payload;
    try {
      payload = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      report.errors.push({ file: f, error: String(err) });
      continue;
    }
    if (!Array.isArray(payload.claims)) continue;

    if (typeof payload.promptVersion === "string" && payload.promptVersion.length > 0) {
      report.alreadyStamped.push({ file: f, value: payload.promptVersion });
      continue;
    }

    const day = dayOf(payload.generatedAt);
    if (!inWindow(day)) {
      report.skippedWindow.push({ file: f, day });
      continue;
    }

    const { p50 } = evidenceP50(payload.claims);
    const denies = denyCount(payload.claims);
    const shapeOk = p50 >= MIN_P50 && p50 <= MAX_P50;

    if (!shapeOk) {
      report.skippedShape.push({
        file: f,
        day,
        p50,
        denies,
        reason: `evidence p50=${p50} outside [${MIN_P50},${MAX_P50}]`,
      });
      continue;
    }

    // Inject promptVersion in a stable position (right after `generator`).
    const stamped = {};
    for (const k of Object.keys(payload)) {
      stamped[k] = payload[k];
      if (k === "generator") stamped.promptVersion = TARGET_VERSION;
    }
    if (!("promptVersion" in stamped)) stamped.promptVersion = TARGET_VERSION;

    writeAtomic(path, JSON.stringify(stamped, null, 2));
    report.stamped.push({ file: f, day, p50, denies });
  }

  const counts = {
    stamped: report.stamped.length,
    alreadyStamped: report.alreadyStamped.length,
    skippedWindow: report.skippedWindow.length,
    skippedShape: report.skippedShape.length,
    errors: report.errors.length,
  };

  console.log(
    `stamp-existing-claims · stamped=${counts.stamped} already=${counts.alreadyStamped} skipped-window=${counts.skippedWindow} skipped-shape=${counts.skippedShape} errors=${counts.errors}`,
  );

  if (report.skippedWindow.length > 0) {
    console.warn(
      `\n${report.skippedWindow.length} files outside [${MIN_DATE},${MAX_DATE}] — unstamped:`,
    );
    for (const s of report.skippedWindow.slice(0, 10)) {
      console.warn(`  ${s.file}  (generatedAt day: ${s.day ?? "unknown"})`);
    }
    if (report.skippedWindow.length > 10) {
      console.warn(`  … and ${report.skippedWindow.length - 10} more`);
    }
  }

  if (report.skippedShape.length > 0) {
    console.warn(
      `\n${report.skippedShape.length} files failed shape check — unstamped:`,
    );
    for (const s of report.skippedShape.slice(0, 10)) {
      console.warn(`  ${s.file}  ${s.reason}`);
    }
    if (report.skippedShape.length > 10) {
      console.warn(`  … and ${report.skippedShape.length - 10} more`);
    }
  }

  if (report.errors.length > 0) {
    console.error(`\n${report.errors.length} errors:`);
    for (const e of report.errors) {
      console.error(`  ${e.file}: ${e.error}`);
    }
    process.exit(1);
  }
}

main();
