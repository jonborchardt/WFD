# ai

All the Claude-Code-driven passes. Each subdirectory ships a set of
`.mjs` scripts (prepare / apply / driver) and is invoked from a Claude
Code session via a named skill under `.claude/skills/`. None of them
are runtime API calls to Claude — everything is batch-oriented and
resumable from on-disk state.

See [CLAUDE.md](../../CLAUDE.md) for the full operator playbook; this
file is just the map of what lives where.

## Subpackages

### `curate/` — heuristic alias curation

Scans every `data/entities/<id>.json` + the corpus, proposes alias
actions (short→long videoMerges, `the X` → `X` corpus merges,
`[music]` artifact deletions), and applies them via the typed
mutators in [../graph/aliases-schema.ts](../graph/aliases-schema.ts).

Also houses [curate/delete-always.ts](curate/delete-always.ts) —
committed `DELETE_ALWAYS` / `ALWAYS_PROMOTE` / `DELETE_LABELS` lists
that the `indexes` pipeline stage auto-applies on every rebuild.

Skill: [ai-alias-curation](../../.claude/skills/ai-alias-curation/SKILL.md).

### `entity-audit/` — tier-1 AI entity audit

AI verdicts over the top-100 mention-count entities per label:
KEEP / DELETE-GLOBAL / MERGE-INTO / PER-VIDEO-MERGE / DEFER.
Shardable across labels (1 agent per label).

Skill: [ai-entity-audit](../../.claude/skills/ai-entity-audit/SKILL.md).

### `entity-resolution/` — per-video coref + normalization

`prepare.mjs` builds per-video bundles for first-name-only persons
with sample contexts + candidate resolutions. `apply.mjs` folds
agent proposals into `videoMerges` / `merges`. `normalize.mjs` is a
pure-code pass that collapses case / title / determiner duplicates.

Skill: [ai-entity-resolution](../../.claude/skills/ai-entity-resolution/SKILL.md).

### `claims/` — per-video AI claim extraction

Claude reads `data/transcripts/<id>.json` + existing
`data/entities/<id>.json` + `data/relations/<id>.json` and writes
`data/claims/<id>.json`. The skill prompt enforces the quality bar:
atomic claims, single-sentence evidence (60–150 chars), calibrated
`directTruth`, aggressive `denies` stance, typed `contradicts`
subkinds. See [claims/README.md](claims/README.md) for script
contracts and [../claims/](../claims/) for the schema + validators.

Skill: [ai-claims-extraction](../../.claude/skills/ai-claims-extraction/SKILL.md).

### `reasoning/` — reasoning-layer driver + embeddings

Drives the pure-code modules in [../truth/](../truth/)
(`claim-propagation`, `claim-contradictions`,
`claim-counterfactual`) for ad-hoc / sample runs against any slice
of the corpus. Also owns `embed-claims.mjs`, which populates
`data/claims/embeddings.json` via the sentence-transformer sidecar
for the cross-video contradiction detector.

Skill: [ai-reasoning-layer](../../.claude/skills/ai-reasoning-layer/SKILL.md).

### `contradiction-verify/` — AI verdicting of cross-video candidates

`prepare.mjs` hydrates each candidate pair with both claims' full
text + evidence + shared entities, then shards across N parallel
agents. Each agent verdicts every pair (LOGICAL-CONTRADICTION /
DEBUNKS / UNDERCUTS / ALTERNATIVE / COMPLEMENTARY / IRRELEVANT /
SAME-CLAIM). `apply.mjs` merges into
`data/claims/contradiction-verdicts.json` and re-runs the
`claim-indexes` filter so the public view only shows verdicted-real
contradictions.

Skill: [ai-contradiction-verify](../../.claude/skills/ai-contradiction-verify/SKILL.md).

### `calibration/` — calibration bundle + gold-sample

`bundle.mjs` emits `_calibration_tmp/examples.json` combining
confirmed-good signal (operator-surviving merges / deletes / display
overrides) and corrected signal (notSame pairs, contradiction
dismissals, operator verdicts) — future AI sessions read it as
few-shot context. `gold-seed.mjs` snapshots ~20 representative
videos' claim files into `data/gold/claims/`; `gold-check.mjs`
diffs current vs gold and fails on material regression.

See [CLAUDE.md § Metrics](../../CLAUDE.md) for the full calibration
+ gate playbook.

## Shared conventions

- Every pass writes to `data/aliases.json` through the typed
  mutators in [../graph/aliases-schema.ts](../graph/aliases-schema.ts)
  or to `data/claims/<id>.json` with strict validation — never to
  `data/entities/` or `data/relations/` directly.
- Resumability is automatic — `pick-videos.mjs` / bundle scripts
  filter out already-done work, so killed sessions re-pick only
  the gaps on the next invocation.
- Atomic writes via temp+rename mean partial writes can never
  produce a corrupt file.
- `_curate_tmp/`, `_claims_tmp/`, `_entity_audit_tmp/`,
  `_entity_resolution_tmp/`, `_contradiction_verify_tmp/`,
  `_reasoning_tmp/`, `_calibration_tmp/` are all gitignored scratch
  — safe to delete between sessions.
