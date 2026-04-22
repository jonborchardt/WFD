// Atomic read/write for data/claims/<videoId>.json. Validation runs on
// both read and write so a corrupt file fails loudly rather than feeding
// downstream truth/reasoning code with bad data.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  assertValidClaims,
  buildValidationContext,
  type ValidationContext,
} from "./validate.js";
import type { PersistedClaims } from "./types.js";

export function claimsDir(dataDir: string): string {
  return join(dataDir, "claims");
}

export function claimsPath(dataDir: string, videoId: string): string {
  return join(claimsDir(dataDir), `${videoId}.json`);
}

export function claimsExist(dataDir: string, videoId: string): boolean {
  return existsSync(claimsPath(dataDir, videoId));
}

export function readClaims(
  dataDir: string,
  videoId: string,
): PersistedClaims | null {
  const p = claimsPath(dataDir, videoId);
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, "utf8")) as PersistedClaims;
  const ctx = buildValidationContext(dataDir, videoId);
  assertValidClaims(parsed, ctx);
  return parsed;
}

export function writeClaims(
  dataDir: string,
  videoId: string,
  payload: PersistedClaims,
  precomputedCtx?: ValidationContext,
): void {
  const ctx = precomputedCtx ?? buildValidationContext(dataDir, videoId);
  assertValidClaims(payload, ctx);

  const dir = claimsDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const finalPath = claimsPath(dataDir, videoId);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmpPath, finalPath);
}
