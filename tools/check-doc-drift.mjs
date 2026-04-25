#!/usr/bin/env node
// check-doc-drift.mjs
//
// Reads tools/doc-drift-assertions.json and verifies every listed phrase
// is present in every file it's asserted to appear in. Exits non-zero on
// any miss with a useful "X says Y but Z does not mention it" message.
//
// Normalization applied before substring match:
//   - en-dash (U+2013) and em-dash (U+2014) collapse to hyphen-minus
//   - smart quotes (U+2018 / U+2019 / U+201C / U+201D) collapse to ASCII
//   - comparison is case-insensitive
//
// Wiring: called by `npm run drift:check`, which CI runs alongside
// `metrics:check`. Source of truth for the rule set lives in
// tools/doc-drift-assertions.json; add a new phrase whenever CLAUDE.md
// tightens a rule that must hold across the codebase.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ASSERTIONS_PATH = join(REPO_ROOT, "tools", "doc-drift-assertions.json");

function normalize(s) {
  return s
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase();
}

function main() {
  if (!existsSync(ASSERTIONS_PATH)) {
    console.error(`no assertions file at ${ASSERTIONS_PATH}`);
    process.exit(2);
  }
  const rules = JSON.parse(readFileSync(ASSERTIONS_PATH, "utf8"));
  if (rules.schemaVersion !== 1 || !Array.isArray(rules.assertions)) {
    console.error(`assertions file malformed (expected schemaVersion=1 and assertions[])`);
    process.exit(2);
  }

  const fileCache = new Map();
  function readNormalized(relPath) {
    if (fileCache.has(relPath)) return fileCache.get(relPath);
    const abs = join(REPO_ROOT, relPath);
    if (!existsSync(abs)) {
      fileCache.set(relPath, null);
      return null;
    }
    const raw = readFileSync(abs, "utf8");
    const normalized = normalize(raw);
    fileCache.set(relPath, normalized);
    return normalized;
  }

  const misses = [];
  let checked = 0;
  for (const assertion of rules.assertions) {
    if (typeof assertion.phrase !== "string" || !Array.isArray(assertion.must_appear_in)) {
      misses.push({
        phrase: String(assertion.phrase ?? "<unknown>"),
        reason: "malformed assertion — missing phrase or must_appear_in",
      });
      continue;
    }
    const normalizedPhrase = normalize(assertion.phrase);
    for (const relPath of assertion.must_appear_in) {
      checked++;
      const content = readNormalized(relPath);
      if (content === null) {
        misses.push({
          phrase: assertion.phrase,
          file: relPath,
          rationale: assertion.rationale,
          reason: `file does not exist`,
        });
        continue;
      }
      if (!content.includes(normalizedPhrase)) {
        misses.push({
          phrase: assertion.phrase,
          file: relPath,
          rationale: assertion.rationale,
          reason: `phrase "${assertion.phrase}" not found`,
        });
      }
    }
  }

  if (misses.length === 0) {
    console.log(
      `drift:check · ${rules.assertions.length} assertions (${checked} file-phrase pairs) — ok`,
    );
    return;
  }

  console.error(`drift:check · FAIL · ${misses.length} miss(es):`);
  for (const m of misses) {
    console.error("");
    console.error(`  phrase:    ${JSON.stringify(m.phrase)}`);
    if (m.file) console.error(`  file:      ${m.file}`);
    if (m.rationale) console.error(`  rationale: ${m.rationale}`);
    console.error(`  ${m.reason}`);
  }
  console.error("");
  console.error(
    `Fix: either add the phrase to the offending file, or update tools/doc-drift-assertions.json to reflect the new reality.`,
  );
  process.exit(1);
}

main();
