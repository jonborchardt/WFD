// Build the AI input bundle for one video.
//
// Writes _claims_tmp/<videoId>.input.json with everything Claude needs to
// extract claims:
//   - flattened transcript text + per-cue char offsets (so AI can pick
//     evidence spans that the validator will accept)
//   - the entity-key allowlist for this video (label:canonical),
//     pre-deduped, with mention counts and the canonical surface form
//   - the relation edges with subject/predicate/object surface forms +
//     evidence char range, so AI can attach existing relationship ids
//   - validation guardrails (length of flattened text, count of entities,
//     count of relations) so AI can sanity-check before writing

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { flatten } from "../../../dist/entities/flatten.js";
import { entityKeyOf } from "../../../dist/graph/canonicalize.js";

const t0 = Date.now();
const dataDir = "data";

const videoId = process.argv[2];
if (!videoId) {
  console.error("usage: node src/ai/claims/prepare.mjs <videoId>");
  process.exit(2);
}

const transcriptPath = join(dataDir, "transcripts", `${videoId}.json`);
const entitiesPath = join(dataDir, "entities", `${videoId}.json`);
const relationsPath = join(dataDir, "relations", `${videoId}.json`);

for (const [label, p] of [
  ["transcript", transcriptPath],
  ["entities", entitiesPath],
  ["relations", relationsPath],
]) {
  if (!existsSync(p)) {
    console.error(`error: missing ${label} file at ${p}`);
    process.exit(1);
  }
}

const transcript = JSON.parse(readFileSync(transcriptPath, "utf8"));
const entities = JSON.parse(readFileSync(entitiesPath, "utf8"));
const relations = JSON.parse(readFileSync(relationsPath, "utf8"));

const flat = flatten(transcript);

// Collapse mentions into the entity-key view (label:canonical), with mention
// counts so AI can preferentially anchor claims on prominent entities.
const entityIndex = new Map();
const mentionById = new Map();
for (const m of entities.mentions) {
  mentionById.set(m.id, m);
  const key = entityKeyOf(m.label, m.canonical);
  if (!entityIndex.has(key)) {
    entityIndex.set(key, {
      key,
      label: m.label,
      canonical: m.canonical,
      mentionCount: 0,
      firstMentionId: m.id,
      firstCharStart: m.span.charStart,
      firstTimeStart: m.span.timeStart,
    });
  }
  const slot = entityIndex.get(key);
  slot.mentionCount++;
  if (m.canonical.length > slot.canonical.length) slot.canonical = m.canonical;
}
const entityList = [...entityIndex.values()].sort(
  (a, b) => b.mentionCount - a.mentionCount || a.key.localeCompare(b.key),
);

// Edges: include subject/object surface + key so AI can decide which to cite.
const edges = relations.edges.map((e) => {
  const s = mentionById.get(e.subjectMentionId);
  const o = mentionById.get(e.objectMentionId);
  return {
    id: e.id,
    predicate: e.predicate,
    score: e.score,
    subject: s
      ? {
          mentionId: s.id,
          key: entityKeyOf(s.label, s.canonical),
          surface: s.surface,
          canonical: s.canonical,
          label: s.label,
        }
      : null,
    object: o
      ? {
          mentionId: o.id,
          key: entityKeyOf(o.label, o.canonical),
          surface: o.surface,
          canonical: o.canonical,
          label: o.label,
        }
      : null,
    evidence: e.evidence,
  };
});

const bundle = {
  videoId,
  generatedAt: new Date().toISOString(),
  transcript: {
    language: transcript.language ?? null,
    cueCount: transcript.cues.length,
    flattenedText: flat.text,
    flattenedTextLength: flat.text.length,
    cueStarts: flat.cueStarts,
    durationSeconds:
      transcript.cues.length > 0
        ? (() => {
            const last = transcript.cues[transcript.cues.length - 1];
            return last.start + last.duration;
          })()
        : 0,
  },
  entities: {
    count: entityList.length,
    mentionTotal: entities.mentions.length,
    items: entityList,
  },
  relations: {
    count: edges.length,
    edges,
  },
  guardrails: {
    flattenedTextLength: flat.text.length,
    validEntityKeyCount: entityList.length,
    validRelationshipIdCount: edges.length,
    note:
      "Every claim.evidence[].quote MUST equal flattenedText.slice(charStart, charEnd). "
      + "Every claim.entities[] MUST be one of items[].key. "
      + "Every claim.relationships[] MUST be one of edges[].id. "
      + "No pronouns in entities. confidence/directTruth in [0,1].",
  },
};

if (!existsSync("_claims_tmp")) mkdirSync("_claims_tmp");
const outPath = join("_claims_tmp", `${videoId}.input.json`);
writeFileSync(outPath, JSON.stringify(bundle, null, 2));

console.log(
  JSON.stringify(
    {
      ms: Date.now() - t0,
      videoId,
      out: outPath,
      flattenedTextLength: flat.text.length,
      cueCount: transcript.cues.length,
      durationSeconds: bundle.transcript.durationSeconds,
      entityKeys: entityList.length,
      relationshipEdges: edges.length,
    },
    null,
    2,
  ),
);
