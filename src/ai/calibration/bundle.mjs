// Plan 05 §F2 — calibration bundle.
//
// Combines operator-confirmed signal (merges/deletes that survived
// review) with operator-corrected signal (claims edited, contradictions
// dismissed) into a compact JSON bundle that future AI sessions can
// read as few-shot context.
//
// Output: _calibration_tmp/examples.json
//
// CLI:
//   node src/ai/calibration/bundle.mjs
//   node src/ai/calibration/bundle.mjs --max 200    # cap per-section

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAliasesFile } from "../../../dist/graph/aliases-schema.js";

const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return args[i + 1];
}
const MAX = Number(arg("--max") ?? 200);
const dataDir = "data";
const outDir = "_calibration_tmp";
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const aliases = readAliasesFile(dataDir);

function take(arr, n) { return Array.isArray(arr) ? arr.slice(0, n) : []; }

// Verdict cache + consonance feed the contradiction-verification skill's
// future prompts. Only operator-confirmed entries get quoted as exemplars;
// AI verdicts don't self-train because that loops on the same model's
// biases.
let operatorVerdicts = [];
try {
  const vPath = join(dataDir, "claims", "contradiction-verdicts.json");
  if (existsSync(vPath)) {
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    operatorVerdicts = (v.verdicts ?? []).filter((x) => x.by === "operator");
  }
} catch {
  /* ignore */
}

const bundle = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  // Confirmed-good signal: surviving without operator contradiction.
  confirmedMerges: take(aliases.merges, MAX).map((m) => ({
    from: m.from,
    to: m.to,
    rationale: m.rationale ?? null,
  })),
  confirmedDeletedEntities: take(aliases.deletedEntities, MAX).map((e) => ({
    key: e.key,
    reason: e.reason ?? null,
  })),
  confirmedDisplayOverrides: take(aliases.display, MAX),
  // Corrections = operator-graded learning signal. These are the
  // anti-examples — AI should never propose work contradicting them.
  notSamePairs: take(aliases.notSame, MAX),
  dismissedContradictions: take(aliases.contradictionDismissals, MAX),
  operatorVerdicts,
  claimTruthOverrides: take(aliases.claimTruthOverrides, MAX),
  claimFieldOverrides: take(aliases.claimFieldOverrides, MAX),
};

const outPath = join(outDir, "examples.json");
writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      outPath,
      counts: {
        confirmedMerges: bundle.confirmedMerges.length,
        confirmedDeletedEntities: bundle.confirmedDeletedEntities.length,
        confirmedDisplayOverrides: bundle.confirmedDisplayOverrides.length,
        notSamePairs: bundle.notSamePairs.length,
        dismissedContradictions: bundle.dismissedContradictions.length,
        operatorVerdicts: bundle.operatorVerdicts.length,
        claimTruthOverrides: bundle.claimTruthOverrides.length,
        claimFieldOverrides: bundle.claimFieldOverrides.length,
      },
    },
    null,
    2,
  ),
);
