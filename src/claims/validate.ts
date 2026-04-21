// Strict validators for claim payloads. Every claim file written by the
// AI session must pass these — a bad write is rejected loudly so Plan 3's
// reasoning code never sees garbage.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { Transcript } from "../entities/types.js";
import { flatten } from "../entities/flatten.js";
import type { PersistedEntities } from "../entities/index.js";
import type { PersistedRelations } from "../relations/index.js";
import { entityKeyOf, readAliases } from "../graph/canonicalize.js";
import {
  CLAIMS_SCHEMA_VERSION,
  type Claim,
  type ClaimEvidence,
  type ClaimId,
  type ClaimKind,
  type DependencyKind,
  type HostStance,
  type PersistedClaims,
} from "./types.js";

const CLAIM_KINDS: ReadonlySet<ClaimKind> = new Set([
  "empirical",
  "historical",
  "speculative",
  "opinion",
  "definitional",
]);

const DEPENDENCY_KINDS: ReadonlySet<DependencyKind> = new Set([
  "supports",
  "contradicts",
  "presupposes",
  "elaborates",
]);

const HOST_STANCES: ReadonlySet<HostStance> = new Set([
  "asserts",
  "denies",
  "uncertain",
  "steelman",
]);

// English personal pronouns + a few transcript-stub forms. AI is required
// to resolve coref before naming entities, so a pronoun in entities[] is
// a contract violation, not a near-miss.
const PRONOUN_STOPLIST: ReadonlySet<string> = new Set([
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "they", "them", "their", "theirs", "themselves",
  "we", "us", "our", "ours", "ourselves",
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself", "yourselves",
  "this", "that", "these", "those",
  "who", "whom", "whose",
]);

export interface ValidationContext {
  transcript: Transcript;
  entities: PersistedEntities;
  relations: PersistedRelations;
  /** All entity keys allowed: union of NER mentions + display-overridden entities. */
  validEntityKeys: ReadonlySet<string>;
  /** All relationship edge ids in the relations file. */
  validRelationshipIds: ReadonlySet<string>;
  /** Flattened transcript text (cue.text joined by "\n"). */
  flattenedText: string;
}

export class ClaimsValidationError extends Error {
  constructor(message: string, public errors: string[]) {
    super(message);
    this.name = "ClaimsValidationError";
  }
}

export function buildValidationContext(
  dataDir: string,
  videoId: string,
): ValidationContext {
  const transcriptPath = join(dataDir, "transcripts", `${videoId}.json`);
  const entitiesPath = join(dataDir, "entities", `${videoId}.json`);
  const relationsPath = join(dataDir, "relations", `${videoId}.json`);

  if (!existsSync(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }
  if (!existsSync(entitiesPath)) {
    throw new Error(`Entities not found: ${entitiesPath}`);
  }
  if (!existsSync(relationsPath)) {
    throw new Error(`Relations not found: ${relationsPath}`);
  }

  const transcript = JSON.parse(
    readFileSync(transcriptPath, "utf8"),
  ) as Transcript;
  const entities = JSON.parse(
    readFileSync(entitiesPath, "utf8"),
  ) as PersistedEntities;
  const relations = JSON.parse(
    readFileSync(relationsPath, "utf8"),
  ) as PersistedRelations;

  const aliases = readAliases(dataDir);
  const validEntityKeys = new Set<string>();
  for (const m of entities.mentions) {
    validEntityKeys.add(entityKeyOf(m.label, m.canonical));
  }
  // Allow display-overridden phantom entities too.
  for (const k of Object.keys(aliases)) {
    if (k.startsWith("display:")) {
      validEntityKeys.add(k.slice("display:".length));
    }
  }

  const validRelationshipIds = new Set<string>(
    relations.edges.map((e) => e.id),
  );

  const { text } = flatten(transcript);

  return {
    transcript,
    entities,
    relations,
    validEntityKeys,
    validRelationshipIds,
    flattenedText: text,
  };
}

function inRange01(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function validateEvidence(
  prefix: string,
  ev: ClaimEvidence,
  ctx: ValidationContext,
  errors: string[],
): void {
  if (ev.transcriptId !== ctx.transcript.videoId) {
    errors.push(
      `${prefix}: transcriptId "${ev.transcriptId}" != "${ctx.transcript.videoId}"`,
    );
  }
  if (
    !Number.isInteger(ev.charStart) ||
    !Number.isInteger(ev.charEnd) ||
    ev.charStart < 0 ||
    ev.charEnd <= ev.charStart ||
    ev.charEnd > ctx.flattenedText.length
  ) {
    errors.push(
      `${prefix}: char span [${ev.charStart},${ev.charEnd}) out of range (text length ${ctx.flattenedText.length})`,
    );
    return;
  }
  if (typeof ev.quote !== "string" || ev.quote.length === 0) {
    errors.push(`${prefix}: quote missing`);
    return;
  }
  const slice = ctx.flattenedText.slice(ev.charStart, ev.charEnd);
  if (slice !== ev.quote) {
    errors.push(
      `${prefix}: quote does not match transcript slice. Expected ${JSON.stringify(slice.slice(0, 80))}, got ${JSON.stringify(ev.quote.slice(0, 80))}`,
    );
  }
  if (
    !Number.isFinite(ev.timeStart) ||
    !Number.isFinite(ev.timeEnd) ||
    ev.timeEnd < ev.timeStart
  ) {
    errors.push(`${prefix}: bad time range [${ev.timeStart},${ev.timeEnd}]`);
  }
}

export function validateClaim(
  claim: Claim,
  ctx: ValidationContext,
  knownIds: ReadonlySet<ClaimId>,
): string[] {
  const errors: string[] = [];
  const p = `claim ${claim.id}`;

  if (!claim.id || typeof claim.id !== "string") {
    errors.push(`${p}: missing id`);
  } else if (!claim.id.startsWith(`${ctx.transcript.videoId}:`)) {
    errors.push(`${p}: id must start with "${ctx.transcript.videoId}:"`);
  }

  if (claim.videoId !== ctx.transcript.videoId) {
    errors.push(`${p}: videoId "${claim.videoId}" != "${ctx.transcript.videoId}"`);
  }

  if (!claim.text || typeof claim.text !== "string" || claim.text.trim().length === 0) {
    errors.push(`${p}: text missing/empty`);
  }

  if (!CLAIM_KINDS.has(claim.kind)) {
    errors.push(`${p}: kind "${claim.kind}" not in ${[...CLAIM_KINDS].join("|")}`);
  }

  if (!Array.isArray(claim.entities)) {
    errors.push(`${p}: entities must be array`);
  } else {
    for (const k of claim.entities) {
      if (typeof k !== "string" || !k.includes(":")) {
        errors.push(`${p}: entity key "${k}" malformed (expected "label:canonical")`);
        continue;
      }
      const canonicalPart = k.split(":", 2)[1] ?? "";
      if (PRONOUN_STOPLIST.has(canonicalPart.trim().toLowerCase())) {
        errors.push(`${p}: entity key "${k}" is a pronoun — resolve coref before writing`);
      }
      if (!ctx.validEntityKeys.has(k)) {
        errors.push(
          `${p}: entity key "${k}" not in this video's entities or display overrides`,
        );
      }
    }
  }

  if (!Array.isArray(claim.relationships)) {
    errors.push(`${p}: relationships must be array`);
  } else {
    for (const rid of claim.relationships) {
      if (!ctx.validRelationshipIds.has(rid)) {
        errors.push(`${p}: relationship id "${rid}" not in this video's relations`);
      }
    }
  }

  if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
    errors.push(`${p}: evidence required (≥1)`);
  } else {
    for (let i = 0; i < claim.evidence.length; i++) {
      validateEvidence(`${p}.evidence[${i}]`, claim.evidence[i], ctx, errors);
    }
  }

  if (!inRange01(claim.confidence)) {
    errors.push(`${p}: confidence ${claim.confidence} not in [0,1]`);
  }

  if (claim.directTruth !== undefined && !inRange01(claim.directTruth)) {
    errors.push(`${p}: directTruth ${claim.directTruth} not in [0,1]`);
  }

  if (typeof claim.rationale !== "string" || claim.rationale.trim().length === 0) {
    errors.push(`${p}: rationale required`);
  }

  if (claim.dependencies) {
    if (!Array.isArray(claim.dependencies)) {
      errors.push(`${p}: dependencies must be array`);
    } else {
      for (const dep of claim.dependencies) {
        if (!knownIds.has(dep.target)) {
          errors.push(`${p}: dependency target "${dep.target}" not a claim id in this file`);
        }
        if (!DEPENDENCY_KINDS.has(dep.kind)) {
          errors.push(`${p}: dependency kind "${dep.kind}" invalid`);
        }
        if (dep.target === claim.id) {
          errors.push(`${p}: dependency self-reference`);
        }
      }
    }
  }

  if (claim.hostStance !== undefined && !HOST_STANCES.has(claim.hostStance)) {
    errors.push(`${p}: hostStance "${claim.hostStance}" invalid`);
  }

  if (
    claim.inVerdictSection !== undefined &&
    typeof claim.inVerdictSection !== "boolean"
  ) {
    errors.push(`${p}: inVerdictSection must be boolean`);
  }

  if (claim.tags !== undefined) {
    if (!Array.isArray(claim.tags)) {
      errors.push(`${p}: tags must be array`);
    } else {
      for (const t of claim.tags) {
        if (typeof t !== "string" || t.trim().length === 0) {
          errors.push(`${p}: tag "${t}" must be non-empty string`);
        }
      }
    }
  }

  return errors;
}

export function validateClaimsPayload(
  payload: PersistedClaims,
  ctx: ValidationContext,
): string[] {
  const errors: string[] = [];

  if (payload.schemaVersion !== CLAIMS_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion ${payload.schemaVersion} != ${CLAIMS_SCHEMA_VERSION}`,
    );
  }
  if (payload.transcriptId !== ctx.transcript.videoId) {
    errors.push(
      `transcriptId "${payload.transcriptId}" != "${ctx.transcript.videoId}"`,
    );
  }
  if (!payload.generatedAt || typeof payload.generatedAt !== "string") {
    errors.push("generatedAt required");
  }
  if (!payload.generator || typeof payload.generator !== "string") {
    errors.push("generator required");
  }
  if (!Array.isArray(payload.claims)) {
    errors.push("claims must be array");
    return errors;
  }

  const ids = new Set<ClaimId>();
  for (const c of payload.claims) {
    if (ids.has(c.id)) {
      errors.push(`duplicate claim id "${c.id}"`);
    }
    ids.add(c.id);
  }

  for (const c of payload.claims) {
    errors.push(...validateClaim(c, ctx, ids));
  }

  return errors;
}

export function assertValidClaims(
  payload: PersistedClaims,
  ctx: ValidationContext,
): void {
  const errors = validateClaimsPayload(payload, ctx);
  if (errors.length > 0) {
    throw new ClaimsValidationError(
      `Claims payload for ${payload.transcriptId} failed validation (${errors.length} errors)`,
      errors,
    );
  }
}
