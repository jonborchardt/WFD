# claims

Per-video thesis-level claims written by an AI session over the transcript
+ NER output. Schema and strict validators only — no extraction or pipeline
stage lives here. The writing side is in
[src/ai/claims/](../ai/claims/README.md) and the
[ai-claims-extraction](../../.claude/skills/ai-claims-extraction/SKILL.md)
skill.

## Files

- [types.ts](types.ts) — `PersistedClaims`, `Claim`, `ClaimEvidence`,
  `ClaimDependency`, the `ClaimKind` union (`empirical` / `historical` /
  `speculative` / `opinion` / `definitional`), the `DependencyKind` union
  (`supports` / `contradicts` / `presupposes` / `elaborates`). Schema
  version 1.
- [validate.ts](validate.ts) — strict, load-bearing validators. Build a
  `ValidationContext` from disk with `buildValidationContext(dataDir,
  videoId)` and run `validateClaimsPayload` or `assertValidClaims`.
  `ClaimsValidationError` carries the full error list. A bad payload
  produces ≥1 error; clean payload returns `[]`.
- [persist.ts](persist.ts) — `readClaims(dataDir, videoId)` validates on
  load and returns `null` if the file is absent; `writeClaims` validates
  before writing and uses temp+rename so a killed process can never leave
  a corrupt file. `claimsExist(dataDir, videoId)` is a cheap presence check.
- [index.ts](index.ts) — public barrel.

## What the validators enforce

A claim payload passes iff every one of these holds:

- `schemaVersion === 1`, `transcriptId` matches the file's stem.
- `claims[]` ids are unique within the file, each prefixed with
  `<videoId>:`.
- `kind` ∈ the five-kind union.
- `entities[]` keys are all `label:canonical` strings drawn from this
  video's `data/entities/<id>.json` *or* from a
  `display:<label>:<canonical>` override in `data/aliases.json`.
  Pronouns (`he` / `she` / `it` / `they` / `this` / …) are rejected —
  coref must be resolved before the name appears in `entities[]`.
- `relationships[]` ids all exist in this video's
  `data/relations/<id>.json`.
- Each `evidence[].quote` equals `flattenedText.slice(charStart, charEnd)`
  byte-for-byte. The flattened text is produced by
  [src/entities/flatten.ts](../entities/flatten.ts) (cue `text` joined by
  `"\n"`). Newlines inside a quote are real `\n` characters — do not
  paraphrase or normalize whitespace.
- `confidence` ∈ [0,1]. `directTruth` ∈ [0,1] when present; omit
  (not 0.5) when uncertain.
- `rationale` is a non-empty string.
- Every `dependencies[].target` is a claim id in the same file; `kind`
  is one of the four dependency kinds; no self-references.
- `hostStance` (when present) ∈ `asserts` / `denies` / `uncertain` /
  `steelman`.

The validator does not police thesis quality (the "is this a real
argument or a restated fact" judgment). That bar is enforced in the
skill prompt and by spot-check.

## Relationship to other modules

- **Immutable inputs:** the validator reads but never writes
  `data/transcripts/<id>.json`, `data/entities/<id>.json`,
  `data/relations/<id>.json`, and `data/aliases.json`.
- **Writes:** only `data/claims/<id>.json`.
- **Downstream:** the `claim-indexes` graph stage (deferred) will
  aggregate per-video claim files into `data/claims/claims-index.json`.
  Plan 3's reasoning code will consume the aggregated file to compute
  per-claim derived truth, corpus-wide contradiction loops, and
  counterfactuals.
