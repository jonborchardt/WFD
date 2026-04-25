---
name: ai-entity-audit
description: Audit top-mention entities in the corpus and propose KEEP / DELETE-GLOBAL / MERGE-INTO / PER-VIDEO-MERGE / DEFER actions. Use when the user asks to "audit entities", "clean up top entities", "run entity hygiene", or after a batch of new videos lands.
version: v1
lastVerifiedAgainstCorpus: 2026-04-24
---

# AI entity audit

A per-label AI audit of
the top-mention entities in the corpus. You read a committed bundle of
entities with context samples and write per-label proposals. A single
`apply.mjs` run merges every proposal file into `aliases.json` with
sort-on-write semantics.

You do NOT touch `data/entities/<id>.json` or
`data/relations/<id>.json`. All decisions flow through
`data/aliases.json` via the typed mutators in
[src/graph/aliases-schema.ts](../../../src/graph/aliases-schema.ts).

## Two modes

- **All-labels mode** (default when user says "run entity audit"):
  one agent per label (person / organization / location / event /
  technology / work_of_media / facility / group_or_movement /
  ideology / nationality_or_ethnicity / date_time) — launch in
  parallel. Each agent owns one bundle.
- **Single-label mode** ("audit person entities"): one agent, one
  bundle.

### Whole-label auto-deletion

Three labels are auto-deleted by the indexes stage via
`DELETE_LABELS` in [src/ai/curate/delete-always.ts](../../../src/ai/curate/delete-always.ts):
`quantity`, `role`, `law_or_policy`. Every entity under these labels
is folded into `aliases.deletedEntities` with a reason prefix
`label:<label>`. They are never audited by this skill — `prepare.mjs`
filters them out. If an operator wants to re-enable a label,
remove it from `DELETE_LABELS` and `unhide` any entities that still
need to come back.

## Steps

Do NOT parallelize within a single label — each bundle is written to
by one agent only. Parallelize **across labels** by launching one Task
per label bundle.

### 1. Ensure dist is fresh

```
npm run build
```

Skip if `dist/ai/curate/delete-always.js` is newer than
`src/ai/curate/delete-always.ts`.

### 2. Generate bundles

```
node src/ai/entity-audit/prepare.mjs --tier 1
```

Or for a single label:

```
node src/ai/entity-audit/prepare.mjs --tier 1 --label person
```

Writes `_entity_audit_tmp/tier-1-<label>.bundle.json` per label.
Entities already in `DELETE_ALWAYS` or `ALWAYS_PROMOTE` are filtered
out (those are handled deterministically by the indexes stage).

### 3. Per-label audit (parallelizable)

For each label bundle, one agent:

1. Read `_entity_audit_tmp/tier-1-<label>.bundle.json`.
2. For each entity in `entities[]`, read the `sampleContexts` and
   `corpusNeighbors` fields to understand how the entity is used.
3. Classify into one verdict:
   - `KEEP` — legitimate proper noun, unambiguous, valuable. No
     write; include in proposals with verdict `"KEEP"` for the
     audit log.
   - `DELETE-GLOBAL` — noise. Role nouns, generic nouns, transcript
     artifacts, tautologies. Populate `key` + `reason`.
   - `MERGE-INTO` — another entity in `corpusNeighbors` is clearly
     the canonical form. Populate `from` (= bundle entity's key) +
     `to` (= neighbor key) + `rationale`.
   - `PER-VIDEO-MERGE` — the entity resolves differently in
     different videos. Emit one `PER-VIDEO-MERGE` per video where
     resolution is clear, each with `videoId` + `from` + `to` +
     `rationale`. Use `sampleContexts` (video-tagged) to decide.
   - `DEFER` — ambiguous, not enough context, or the right call
     requires cross-video analysis (defer to cross-video resolution resolution).
     Populate `key` + `reason`.
4. Write `_entity_audit_tmp/tier-1-<label>.proposals.json`:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "<ISO>",
  "label": "person",
  "agent": "claude-opus-4-7",
  "summary": {
    "total": <N>,
    "keep": <N>,
    "deleteGlobal": <N>,
    "mergeInto": <N>,
    "perVideoMerge": <N>,
    "defer": <N>
  },
  "proposals": [
    { "verdict": "DELETE-GLOBAL", "key": "person:scientists", "reason": "role noun" },
    { "verdict": "MERGE-INTO",     "from": "person:roger", "to": "person:roger patterson", "rationale": "every sampleContext quotes 'Roger Patterson' earlier in same transcript" },
    { "verdict": "PER-VIDEO-MERGE", "videoId": "<vid>", "from": "person:paul", "to": "person:paul mccartney", "rationale": "beatles-focused video; ambient context is Beatles" },
    { "verdict": "KEEP", "key": "person:roger patterson", "rationale": "unambiguous famous figure" },
    { "verdict": "DEFER", "key": "person:dan", "reason": "multiple dans across videos; needs cross-video resolution" }
  ]
}
```

### 4. Apply (single sequential run at the end)

Once all agents are done:

```
node src/ai/entity-audit/apply.mjs
```

Reads every `*.proposals.json` file, applies proposals through the
typed mutators, skips anything already handled. Writes
`_entity_audit_tmp/aliases.before.json` backup on first run.

### 5. Rebuild indexes

```
npx captions pipeline --stage indexes
```

The indexes stage also auto-applies `DELETE_ALWAYS` +
`ALWAYS_PROMOTE` as a side effect.

### 6. Report

```
node src/ai/entity-audit/report.mjs
```

Prints a JSON impact report: per-label counts, top-30
noise-candidates remaining. Relay the highlights back to the user:

- **Applied**: counts of delete-global / merge / per-video-merge
- **Before vs after**: `data/aliases.json` section sizes
- **Remaining noise candidates** (top 10 by mention count)

## Quality bar per verdict

Reject your own output and re-classify if any of these fail:

### DELETE-GLOBAL

Only emit when the entity is categorically noise across the corpus:
- Role noun ("person:scientists", "person:farmer" standalone)
- Generic noun ("organization:company", "location:house")
- Transcript artifact ("[music]" in canonical, outro words like
  "patreon", "discord")
- Tautology ("technology:technology")

If the entity is only *sometimes* noise (e.g. "person:paul" might be
a farmer in one video, McCartney in another), **do not** use
DELETE-GLOBAL. Use PER-VIDEO-MERGE per video, or DEFER.

### MERGE-INTO

Only emit when:
- A corpus neighbor in the same label exists, AND
- At least 3 sample contexts clearly reference the neighbor's fuller
  form ("Roger Patterson" appears within 100 chars of every "Roger"
  sample), AND
- The merge would be true across ALL videos that mention the
  shorter form (otherwise use PER-VIDEO-MERGE).

Do not emit MERGE-INTO for role-noun → specific-person (that's just
deletion of the role-noun form).

### PER-VIDEO-MERGE

Emit when the entity is ambiguous but its context within one video
clearly disambiguates. Requires:
- At least 2 sample contexts from the target video
- The same resolution across all of them
- The corpus has a neighbor matching the resolved form

### DEFER

Use when:
- Context is genuinely ambiguous after reading all samples
- Cross-video analysis would be needed to resolve
- You're below 70% confidence

DEFER is cheap — later passes pick up deferred items.

### KEEP

For high-mention entities that are legitimate proper nouns — use
this sparingly; it's mainly for audit-log completeness and does
not trigger any write. If you're going to KEEP 80% of the bundle,
just process the ones you'd move and skip the rest.

## Invariants

- Never touch `data/entities/*.json` or `data/relations/*.json`.
- Never write to `data/aliases.json` directly — always via the
  proposals file and the apply script.
- Respect existing `notSame` pairs: apply.mjs skips conflicting
  proposals, but don't waste tokens proposing them.
- Per-video-merge targets must exist in the corpus (apply.mjs
  enforces; your proposals should pre-check against the bundle's
  `corpusNeighbors` and the global corpus).

## When to stop

If apply.mjs reports > 50% skipped, something is wrong with the
proposals — stop, diagnose with `--verbose`, and redo the label.
