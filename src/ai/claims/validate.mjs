// Validate data/claims/<videoId>.json. Wraps the strict validators in
// dist/claims/validate.js. Exit code 0 on success, 1 on validation
// failure (errors printed). Used by the skill after each Claude write.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildValidationContext,
  validateClaimsPayload,
} from "../../../dist/claims/validate.js";

const t0 = Date.now();
const dataDir = "data";

const videoId = process.argv[2];
if (!videoId) {
  console.error("usage: node src/ai/claims/validate.mjs <videoId>");
  process.exit(2);
}

const claimsPath = join(dataDir, "claims", `${videoId}.json`);
if (!existsSync(claimsPath)) {
  console.error(`error: missing claims file at ${claimsPath}`);
  process.exit(1);
}

const payload = JSON.parse(readFileSync(claimsPath, "utf8"));
const ctx = buildValidationContext(dataDir, videoId);
const errors = validateClaimsPayload(payload, ctx);

if (errors.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        ms: Date.now() - t0,
        videoId,
        errorCount: errors.length,
        errors,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const kindHist = {};
for (const c of payload.claims) {
  kindHist[c.kind] = (kindHist[c.kind] ?? 0) + 1;
}
let evidenceTotal = 0;
let dependencyTotal = 0;
let directTruthCount = 0;
let inVerdictCount = 0;
for (const c of payload.claims) {
  evidenceTotal += c.evidence.length;
  dependencyTotal += c.dependencies?.length ?? 0;
  if (c.directTruth !== undefined) directTruthCount++;
  if (c.inVerdictSection) inVerdictCount++;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ms: Date.now() - t0,
      videoId,
      claimCount: payload.claims.length,
      kindHist,
      evidenceTotal,
      dependencyTotal,
      directTruthCount,
      inVerdictCount,
    },
    null,
    2,
  ),
);
