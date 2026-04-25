---
name: ai-claims-extraction
description: Run an AI claim-extraction session at the v2 quality bar (atomic theses, 60-150 char evidence, typed contradicts, aggressive denies, calibrated directTruth). Use when the user asks to "extract claims", "run the claims session", "write claim files", "do claims for N videos", or any time a video needs data/claims/<id>.json populated from its transcript + entities + relations.
version: v2
lastVerifiedAgainstCorpus: 2026-04-24
---

# AI claims extraction (v2)

Per-video claim authoring. You (Claude) read the transcript + existing
NER output for each video and write `data/claims/<videoId>.json`
directly. The validators in
[src/claims/validate.ts](../../../src/claims/validate.ts) gate every
write — a bad payload is rejected loudly, not silently dropped.

This is an **AI session**, not pure code. You do the thinking; the helper
scripts in [src/ai/claims/](../../../src/ai/claims/) handle plumbing
(picking videos, packaging the input bundle, post-write validation).

The v2 prompt-of-record was lost in 2026-04-24's working-tree cleanup —
this file is its reconstruction from CLAUDE.md, the corpus fingerprint
([data/claims/_v2-fingerprint.json](../../../data/claims/_v2-fingerprint.json)),
and commit `0c7e60b`. **Do not soften the bar without bumping `version` and
re-baselining the fingerprint.**

## Steps

Do NOT parallelize across videos. Per video, the prepare → write →
validate sequence is sequential — validation reads what you just wrote.
You MAY parallelize the prepare-only or validate-only commands across
distinct video ids if needed for performance.

### 1. Ensure `dist/` is fresh

```
npm run build
```

The helper scripts import from `dist/claims/` and `dist/entities/`. Skip
if `dist/claims/validate.js` is newer than `src/claims/validate.ts`.

### 2. Pick the batch

Default to 2 random videos that have entities + relations but no claim
file yet:

```
node src/ai/claims/pick-videos.mjs --count 2
```

Pin specific ids if the user asked for them:

```
node src/ai/claims/pick-videos.mjs --video <id1> --video <id2>
```

Reads picks from `_claims_tmp/picks.json`. Report the picks back to the
user before proceeding so they can abort if any pick is unsuitable.

Initialize the timings tracker for the summary script:

```
echo '{"videos":{}}' > _claims_tmp/timings.json
```

### 3. Per-video loop

For each picked video id:

#### a. Prepare the input bundle

```
node src/ai/claims/prepare.mjs <videoId>
```

Writes `_claims_tmp/<videoId>.input.json` containing:
- `transcript.flattenedText` — the exact text the validator will slice
  with `charStart`/`charEnd`. Quotes in evidence MUST equal
  `flattenedText.slice(charStart, charEnd)`. Match it byte-for-byte,
  including newlines `\n`.
- `transcript.cueStarts` — char offset of each cue in the flattened text.
- `entities.items[]` — the **only** entity keys you may put in
  `claim.entities[]`. Each item has `key` (label:canonical),
  `mentionCount`, and `firstCharStart` for orientation.
- `relations.edges[]` — the **only** relationship ids you may put in
  `claim.relationships[]`. Each edge has subject/object surface forms
  + evidence char range.

#### b. Read the bundle

Use the Read tool on `_claims_tmp/<videoId>.input.json`. For long
transcripts, read in slices — the bundle is JSON, so read just the
fields you need at first (cue overview, entity list, relation list)
before pulling the full text.

#### c. Compose claim payload

Aim for **8–15 claims per video** (corpus median = 14, see
fingerprint). Write a `PersistedClaims` object (schema:
[src/claims/types.ts](../../../src/claims/types.ts)) with:

- `schemaVersion: 1`
- `transcriptId: <videoId>`
- `generatedAt`: ISO timestamp
- `generator`: `"claude-opus-4-7"` (or whichever model you are)
- `promptVersion: "v2"` — required. Files without this are flagged by
  metrics + drift checks as legacy / pre-v2 output.
- `claims[]`: 8–15 thesis-level claims

Per claim:

- `id`: `"<videoId>:c_0001"`, `"…:c_0002"`, … zero-padded, unique within file
- `text`: 1–2 sentences, **thesis-level and atomic**. A claim is a
  single testable proposition. If you find yourself writing "X and Y"
  where X and Y are independently testable, split them into two claims
  and link with `supports` or `elaborates` — don't bundle.
- `kind`: `empirical` | `historical` | `speculative` | `opinion` | `definitional`
- `entities[]`: entity keys from `bundle.entities.items[].key`. **No
  pronouns**, no entities not in the bundle. Coref-resolve every
  reference: if the transcript says "he" and means John Burns, use
  `person:john burns`.
- `relationships[]`: ids from `bundle.relations.edges[].id` that
  evidence this claim. May be empty.
- `evidence[]`: ≥1 entry, each with `transcriptId`, `charStart`,
  `charEnd`, `timeStart`, `timeEnd`, `quote`. Quote must match
  `flattenedText.slice(charStart, charEnd)` **exactly**, newlines and
  all. **Target 60–150 chars per quote** (corpus p50 = 93). Hard ceiling
  300; multiple narrow evidence entries beat one paragraph-sized quote.
  Pull `timeStart`/`timeEnd` from the cue covering the span (use
  `cueStarts` to locate the right cue, then transcript.cues[i].start
  and start+duration).
- `confidence`: 0..1 — your certainty the host is asserting this claim
- `directTruth`: 0..1 (optional). **Set only when you have a real basis**
  — verdict-section signal, cited evidence, or widely-documented
  factual grounding. Omit otherwise. Never default to 0.5.
- `rationale`: short string explaining the directTruth (or why you
  declined). Required.
- `dependencies[]` (optional): `{target: <other claim id in this file>,
  kind: supports|contradicts|presupposes|elaborates, rationale?}`.
  **Aim for ≥55% of claims in the file to carry ≥1 dep edge** —
  reasoning needs the DAG. Cluster: if one claim presupposes another,
  if two claims contradict, if one elaborates the host's frame —
  wire it.
- `inVerdictSection` (optional): true iff the claim is extracted from
  the host's end-of-video verdict section ("so, is it true?"). Use
  this signal to bump `directTruth` confidence.
- `hostStance` (optional): `asserts` | `denies` | `uncertain` |
  `steelman`. **Tag `denies` aggressively** — when the host presents a
  claim *in order to reject it* ("some say X, but…"), the X-claim is
  extracted with `hostStance: "denies"`. Target ≥5% of claims in the
  file. This is the primary signal the cross-video contradiction
  detector keys on; under-tagging silently breaks corpus-wide reasoning.

##### Typed `contradicts` rationale (mandatory)

Every `contradicts` dependency's `rationale` MUST begin with one of
four typed prefixes — parsed by
[src/truth/contradicts-subkind.ts](../../../src/truth/contradicts-subkind.ts)
to decide how strongly the contradiction propagates through the DAG.

- `[logical]` — strictly cannot both be true (mutually exclusive)
- `[debunks]` — A presents evidence B is false (forensic / corroboration breakdown)
- `[alternative]` — A and B are competing primary explanations of the same event
- `[undercuts]` — A reduces B's probative value but both can be partially true

Untyped contradicts deps are a regression — the metrics gate fires
when typed-pct drops below 95%.

Record the start time before composing and the end time after writing
the file (millisecond precision).

#### d. Write the claim file

Use the Write tool on `data/claims/<videoId>.json`. The directory may
not exist yet — Write creates parents. (It will, however, fail if you
forget to read the file first; since the file is new, just write it.)

#### e. Validate

```
node src/ai/claims/validate.mjs <videoId>
```

If the script exits non-zero, **fix the file and re-write** before
moving to the next video. Common errors:

- `quote does not match transcript slice` — your `charStart`/`charEnd`
  are off, or you typed the quote instead of slicing it
- `entity key … not in this video's entities` — you used a name not
  in `bundle.entities.items[]`. Either you guessed at coref wrong or
  the entity isn't named in this transcript. Drop it or substitute a
  related entity that *is* in the bundle.
- `entity key … is a pronoun` — coref-resolve before writing
- `relationship id … not in this video's relations` — typo on the
  edge id
- `promptVersion` missing / wrong — must be `"v2"` exactly

Re-run `validate.mjs` until it prints `"ok": true`.

#### f. Append to timings

After successful validation, append the per-video timing:

```
node -e 'const fs=require("fs");const t=JSON.parse(fs.readFileSync("_claims_tmp/timings.json","utf8"));t.videos["<videoId>"]={startedAt:"<ISO>",finishedAt:"<ISO>",elapsedMs:<N>};fs.writeFileSync("_claims_tmp/timings.json",JSON.stringify(t,null,2));'
```

### 4. Summarize

```
node src/ai/claims/summary.mjs
```

Prints a JSON report: per-video claim count, kind histogram, per-video
timing, total elapsed. Relay the highlights back to the user:

- N videos processed, M total claims (avg M/N per video)
- Kind distribution
- Per-video elapsed time + total elapsed
- Any videos that failed validation (should be zero by this point)

## Quality bar (v2)

Reject your own output and rewrite if any of these fail. These are not
guidelines — they're the v2 contract. Numbers come from the corpus
fingerprint at [data/claims/_v2-fingerprint.json](../../../data/claims/_v2-fingerprint.json).

1. **Atomicity.** Each claim is a *single* testable proposition. Split
   compound "X and Y" claims into two and wire them with `supports` or
   `elaborates`. Heuristic: if you can imagine someone agreeing with
   half and disagreeing with the other half, it's two claims.

2. **Single-sentence evidence, 60–150 chars target.** Each
   `ClaimEvidence.quote` aims for one tight sentence. Hard ceiling 300
   — long quotes are almost always a sign you're being lazy about
   `charStart`/`charEnd`. Multiple narrow evidence entries are
   strictly better than one paragraph-sized quote: each entry pins a
   different supporting moment.

3. **Calibrated `directTruth`.** Set only when verdict-section signal,
   cited external evidence, or widely-documented factual grounding
   gives you a real basis. Otherwise omit it. Never use 0.5 as a
   fence-sit default. Truth without evidence is noise.

4. **Aggressive `denies` hostStance, ≥5% target.** When the host
   *introduces a claim in order to reject it* ("some people say X,
   but…"), the X-claim is extracted with `hostStance: "denies"`. The
   cross-video contradiction detector relies on this asymmetry to
   surface real disagreements; under-tagging silently breaks reasoning.

5. **Typed `contradicts` subkinds, ≥95% typed.** Every `contradicts`
   dep's `rationale` begins with `[logical]`, `[debunks]`,
   `[alternative]`, or `[undercuts]`. The propagation engine reads the
   tag to choose coupling strength. Untyped → counts as a quality
   regression.

6. **Dependency coverage, target ≥55%.** Wire deps where the
   structure is obvious — one claim presupposes another, two claims
   contradict, an elaboration chain. The reasoning layer is the whole
   point of this corpus; orphan claims contribute nothing to it.

7. **Thesis, not fact atom.** Rule of thumb: a relation ("X is in Y")
   is not a claim; "Y has been the historical seat of X because…" is.
   Fact atoms belong in `data/relations/<id>.json`, which the pipeline
   already produces. Claims are the layer above that.

8. **Real `rationale`.** Explain why this directTruth (or why you
   declined to set it). Tautologies — "plausible because it sounds
   plausible" — are not acceptable.

## Examples (v2 anchors)

These are real entries from the corpus. They're the shape to match.

### Example 1 — atomic empirical claim with cited evidence

```json
{
  "id": "<videoId>:c_0004",
  "videoId": "<videoId>",
  "text": "An electron in isolation would have no mass; the mass we measure comes from the electron's continuous interaction with the Higgs boson field.",
  "kind": "empirical",
  "entities": [
    "person:daniel whiteson",
    "person:higs",
    "event:higs bzon"
  ],
  "relationships": [],
  "evidence": [
    {
      "transcriptId": "<videoId>",
      "charStart": 72334,
      "charEnd": 72394,
      "timeStart": 4093.28,
      "timeEnd": 4098.08,
      "quote": "electron just moving through\nthe universe would have no mass"
    }
  ],
  "confidence": 0.95,
  "directTruth": 0.95,
  "rationale": "Standard model physics: fermion masses arise via Yukawa coupling to the Higgs field — well-established since the Higgs discovery in 2012.",
  "hostStance": "asserts",
  "tags": ["higgs-boson", "electron", "standard-model"]
}
```

Atomic (one proposition). Evidence quote = 60 chars (right in target).
`directTruth` set with real grounding (standard model). Tags are
lowercase kebab-case.

### Example 2 — `[debunks]` typed contradiction wiring

```json
{
  "id": "<videoId>:c_0009",
  "text": "Handwriting analysis of the corroborating letter attributed to witness Janet Kimball matched Linda Napolitano's own handwriting.",
  "kind": "empirical",
  "entities": [
    "person:janet kimball",
    "person:linda",
    "person:linda napolitano"
  ],
  "relationships": [],
  "evidence": [
    {
      "transcriptId": "<videoId>",
      "charStart": 27215,
      "charEnd": 27299,
      "timeStart": 1649.34,
      "timeEnd": 1657.799,
      "quote": "handwriting analysis was done on her\nletter and the handwriting is a match\nfor Linda"
    }
  ],
  "confidence": 0.9,
  "directTruth": 0.7,
  "rationale": "Host attributes this to the Hansen/Butler/Stefula debunker investigation, presenting it as a finding that undercuts the case.",
  "hostStance": "asserts",
  "tags": ["handwriting", "hoax-evidence", "janet-kimball"],
  "dependencies": [
    {
      "target": "<videoId>:c_0003",
      "kind": "contradicts",
      "rationale": "[debunks] If Linda wrote the Janet Kimball letter herself, Kimball is not an independent witness."
    }
  ]
}
```

`[debunks]` prefix because the handwriting finding presents *evidence
that the corroborating-witness claim is false*, not just a competing
explanation. Compare: `[alternative]` would mean two equally-supported
theories of the same event; `[undercuts]` would mean reducing
probative value without falsifying.

## Invariants

- NER files (`data/entities/<id>.json`, `data/relations/<id>.json`) are
  **immutable**. Never edit them. If an entity you want isn't in the
  bundle, drop it from the claim — do not add it to the entities file.
- Only write to `data/claims/<id>.json` and `_claims_tmp/`. Never to
  `data/aliases.json` from this skill — alias work belongs to the
  ai-alias-curation skill.
- Schema version is 1. Bump only when types change. The v2 quality bar
  is *prompt-level*, not schema-level — the data shape stays compatible.

## When to stop a session

If validate.mjs keeps failing on the same video after 2–3 retries,
stop, report the issue, and ask the user. Don't ship a half-validated
claim file by skipping validation.
