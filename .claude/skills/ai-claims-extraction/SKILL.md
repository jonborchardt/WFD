---
name: ai-claims-extraction
description: Run an AI claim-extraction session. Use when the user asks to "extract claims", "run the claims session", "write claim files", "do claims for N videos", or any time a video needs data/claims/<id>.json populated from its transcript + entities + relations.
---

# AI claims extraction

Per-video claim authoring. You (Claude) read the transcript + existing
NER output for each video and write `data/claims/<videoId>.json`
directly. The validators in
[src/claims/validate.ts](../../../src/claims/validate.ts) gate every
write — a bad payload is rejected loudly, not silently dropped.

This is an **AI session**, not pure code. You do the thinking; the helper
scripts in [src/ai/claims/](../../../src/ai/claims/) handle plumbing
(picking videos, packaging the input bundle, post-write validation).

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

Aim for **3–15 claims per video**. Write a `PersistedClaims` object
(schema: [src/claims/types.ts](../../../src/claims/types.ts)) with:

- `schemaVersion: 1`
- `transcriptId: <videoId>`
- `generatedAt`: ISO timestamp
- `generator`: `"claude-opus-4-7"` (or whichever model you are)
- `claims[]`: 3–15 thesis-level claims

Per claim:

- `id`: `"<videoId>:c_0001"`, `"…:c_0002"`, … zero-padded, unique within file
- `text`: 1–2 sentences, **thesis-level** — not atomic facts. If it
  could be the title of a Wikipedia section or an argument someone
  would debate, it's a claim. If it's a single GLiREL-style fact atom
  ("Dan met Alice in 1988"), it belongs in relations, not claims.
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
  all. Pull `timeStart`/`timeEnd` from the cue covering the span (use
  `cueStarts` to locate the right cue, then transcript.cues[i].start
  and start+duration).
- `confidence`: 0..1 — your certainty the host is asserting this claim
- `directTruth`: 0..1 (optional) — your best judgment of truthiness if
  you have one. Omit if you don't.
- `rationale`: short string explaining the directTruth (or why you
  declined). Required.
- `dependencies[]` (optional): `{target: <other claim id in this file>,
  kind: supports|contradicts|presupposes|elaborates, rationale?}`
- `inVerdictSection` (optional): true iff the claim is extracted from
  the host's end-of-video verdict section ("so, is it true?"). Use
  this signal to bump `directTruth` confidence.
- `hostStance` (optional): `asserts|denies|uncertain|steelman`

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

## Quality bar

Reject your own output and rewrite if any of these fail:

- Each claim is a **thesis**, not a fact. Rule of thumb: a relation
  ("X is in Y") is not a claim; "Y has been the historical seat of X
  because…" is.
- Evidence quotes are **substantive** — not single-word fragments.
  Aim for 50–300 characters per quote, the actual sentence(s) where
  the host makes the claim.
- `rationale` is real reasoning, not a tautology. "Plausible because
  it sounds plausible" is not acceptable.
- `directTruth` is set when you have an opinion; omitted (not 0.5) when
  you genuinely don't.
- Dependencies wired up where the structure is obvious (one claim
  presupposes another, two claims contradict, etc.).

## Invariants

- NER files (`data/entities/<id>.json`, `data/relations/<id>.json`) are
  **immutable**. Never edit them. If an entity you want isn't in the
  bundle, drop it from the claim — do not add it to the entities file.
- Only write to `data/claims/<id>.json` and `_claims_tmp/`. Never to
  `data/aliases.json` from this skill — alias work belongs to the
  ai-alias-curation skill.
- Schema version is 1. Bump only when types change.

## When to stop a session

If validate.mjs keeps failing on the same video after 2–3 retries,
stop, report the issue, and ask the user. Don't ship a half-validated
claim file by skipping validation.
