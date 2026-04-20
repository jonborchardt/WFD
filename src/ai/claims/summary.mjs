// End-of-batch report. Reads _claims_tmp/picks.json + _claims_tmp/timings.json
// and prints per-video stats + total elapsed. The skill writes timings.json
// after each video; this script just aggregates.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = "data";

if (!existsSync("_claims_tmp/picks.json")) {
  console.error("error: _claims_tmp/picks.json missing — run pick-videos.mjs first");
  process.exit(1);
}
const picks = JSON.parse(readFileSync("_claims_tmp/picks.json", "utf8"));
const timings = existsSync("_claims_tmp/timings.json")
  ? JSON.parse(readFileSync("_claims_tmp/timings.json", "utf8"))
  : { videos: {} };

const rows = [];
let totalClaims = 0;
let totalEvidence = 0;
const kindHist = {};
let totalElapsedMs = 0;

for (const vid of picks.videos) {
  const claimsPath = join(dataDir, "claims", `${vid}.json`);
  const t = timings.videos?.[vid] ?? {};
  if (!existsSync(claimsPath)) {
    rows.push({ videoId: vid, status: "MISSING", ...t });
    continue;
  }
  const payload = JSON.parse(readFileSync(claimsPath, "utf8"));
  totalClaims += payload.claims.length;
  let ev = 0;
  for (const c of payload.claims) {
    ev += c.evidence.length;
    kindHist[c.kind] = (kindHist[c.kind] ?? 0) + 1;
  }
  totalEvidence += ev;
  totalElapsedMs += t.elapsedMs ?? 0;
  rows.push({
    videoId: vid,
    status: "ok",
    claims: payload.claims.length,
    evidence: ev,
    ...t,
  });
}

const report = {
  pickedAt: picks.pickedAt,
  videoCount: picks.videos.length,
  totalClaims,
  totalEvidence,
  kindHist,
  totalElapsedMs,
  totalElapsedSec: Number((totalElapsedMs / 1000).toFixed(2)),
  perVideo: rows,
};

console.log(JSON.stringify(report, null, 2));
