// Post-process NER mentions so the graph merge is sane.
//
// Three concerns:
//
//   1. PERSON_STOPWORDS  — BERT-NER trained on CoNLL-2003 news wire fires
//      `PER` on words like "God", "Lord", "Dad" in conspiracy/interview
//      corpora where they appear constantly. Drop them entirely.
//
//   2. Per-transcript long-form binding — "Dan" alone is a first name that
//      normalize() would otherwise collapse across every unrelated transcript
//      into a single global `person:dan` entity. Bind each short mention to
//      a multi-token mention from the same transcript when exactly one
//      multi-token candidate shares a token with it. Unbound short mentions
//      are scoped to the transcript so they do not merge across videos.
//
//   3. LOCATION_ALIASES  — small hand-maintained map that collapses US /
//      USA / United States / America into one entity, etc. The same
//      treatment for organizations would be nice but the long tail there is
//      too unbounded; start with locations where the list is short.
//
// The entry point canonicalizeNerMentions() takes a NerMention[] plus the
// transcriptId and returns a new filtered + rewritten list. The original
// mentions are not mutated.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NerMention } from "./ner.js";

const PERSON_STOPWORDS = new Set<string>([
  "god",
  "lord",
  "jesus",
  "christ",
  "allah",
  "buddha",
  "satan",
  "devil",
  "dad",
  "mom",
  "mum",
  "mama",
  "papa",
  "father",
  "mother",
  "son",
  "daughter",
  "brother",
  "sister",
  "uncle",
  "aunt",
  "grandma",
  "grandpa",
  "grandfather",
  "grandmother",
  "sir",
  "mister",
  "madam",
  "ma'am",
  "doc",
  "doctor",
  "professor",
  "senator",
  "congressman",
  "congresswoman",
  "president",
  "mr",
  "mrs",
  "ms",
  "dr",
]);

// Canonical location → list of surface forms that should merge into it.
// Keys are the canonical form; values are aliases compared case-insensitively.
const LOCATION_CANONICALS: Array<[string, string[]]> = [
  [
    "United States",
    [
      "us",
      "u.s.",
      "u.s",
      "usa",
      "u.s.a.",
      "u.s.a",
      "america",
      "the us",
      "the united states",
      "united states of america",
      "the states",
    ],
  ],
  [
    "United Kingdom",
    ["uk", "u.k.", "u.k", "britain", "great britain", "the uk", "england"],
    // England is technically a sub-region but the corpus uses it interchangeably.
  ],
  ["Soviet Union", ["ussr", "u.s.s.r.", "the soviet union", "soviet russia"]],
  ["European Union", ["eu", "e.u.", "the eu"]],
  ["North Korea", ["dprk", "d.p.r.k.", "north korean"]],
  ["South Korea", ["rok", "south korean"]],
];

// Flattened alias → canonical map built once at module load.
const LOCATION_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of LOCATION_CANONICALS) {
    m.set(canonical.toLowerCase(), canonical);
    for (const a of aliases) m.set(a.toLowerCase(), canonical);
  }
  return m;
})();

// Hand-curated org aliases. Bounded list of high-value US federal + major
// international bodies. Long-tail org canonicalization is intentionally not
// attempted here — orgs with similar names are often genuinely different
// (Department of Justice ≠ Department of Education). Add new entries on
// demand. Aliases are matched case-insensitively.
const ORG_CANONICALS: Array<[string, string[]]> = [
  ["Federal Bureau of Investigation", ["fbi", "f.b.i.", "the fbi"]],
  ["Central Intelligence Agency", ["cia", "c.i.a.", "the cia"]],
  ["National Security Agency", ["nsa", "n.s.a.", "the nsa"]],
  ["Department of Justice", ["doj", "d.o.j.", "the doj", "justice department"]],
  ["Department of Defense", ["dod", "d.o.d.", "the dod", "defense department", "pentagon"]],
  ["Department of Homeland Security", ["dhs", "d.h.s.", "the dhs"]],
  ["Department of Energy", ["doe", "d.o.e."]],
  ["Department of State", ["state department", "dos"]],
  ["Department of the Treasury", ["treasury department", "us treasury", "u.s. treasury"]],
  ["Food and Drug Administration", ["fda", "f.d.a.", "the fda"]],
  ["Centers for Disease Control and Prevention", ["cdc", "c.d.c.", "the cdc"]],
  ["National Institutes of Health", ["nih", "n.i.h.", "the nih"]],
  ["World Health Organization", ["who", "w.h.o.", "the who"]],
  ["Securities and Exchange Commission", ["sec", "s.e.c.", "the sec"]],
  ["Internal Revenue Service", ["irs", "i.r.s.", "the irs"]],
  ["Drug Enforcement Administration", ["dea", "d.e.a.", "the dea"]],
  ["Bureau of Alcohol, Tobacco, Firearms and Explosives", ["atf", "a.t.f.", "the atf"]],
  ["United States Postal Service", ["usps", "u.s.p.s.", "post office"]],
  ["Federal Aviation Administration", ["faa", "f.a.a.", "the faa"]],
  ["National Aeronautics and Space Administration", ["nasa", "n.a.s.a."]],
  ["Environmental Protection Agency", ["epa", "e.p.a.", "the epa"]],
  ["United Nations", ["un", "u.n.", "the un", "united nations organization"]],
  ["North Atlantic Treaty Organization", ["nato", "n.a.t.o."]],
  ["European Union", ["eu", "e.u.", "the eu"]],
  ["International Monetary Fund", ["imf", "i.m.f.", "the imf"]],
  ["World Bank", ["the world bank", "world bank group"]],
  ["International Atomic Energy Agency", ["iaea", "i.a.e.a."]],
  ["European Central Bank", ["ecb", "e.c.b."]],
  ["World Trade Organization", ["wto", "w.t.o."]],
  ["World Economic Forum", ["wef", "w.e.f.", "davos"]],
];

// Optional TSV side-loader: data/gazetteer/organization_aliases.tsv with
// `alias<TAB>canonical` rows. Lets you extend the alias map without touching
// code. Loaded lazily on first canonicalization call.
let ORG_ALIAS: Map<string, string> | null = null;

function buildOrgAlias(dataDir?: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of ORG_CANONICALS) {
    m.set(canonical.toLowerCase(), canonical);
    for (const a of aliases) m.set(a.toLowerCase(), canonical);
  }
  const root = dataDir ?? join(process.cwd(), "data");
  const tsv = join(root, "gazetteer", "organization_aliases.tsv");
  if (existsSync(tsv)) {
    try {
      const body = readFileSync(tsv, "utf8");
      for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [alias, canonical] = trimmed.split(/\t+/);
        if (!alias || !canonical) continue;
        m.set(alias.toLowerCase(), canonical);
        m.set(canonical.toLowerCase(), canonical);
      }
    } catch {
      // Malformed file is non-fatal — fall back to the built-in list.
    }
  }
  return m;
}

function orgAlias(dataDir?: string): Map<string, string> {
  if (!ORG_ALIAS) ORG_ALIAS = buildOrgAlias(dataDir);
  return ORG_ALIAS;
}

// Test-only: reset the cached org alias map so a test can swap dataDir.
export function _resetOrgAliasCache(): void {
  ORG_ALIAS = null;
}

function tokens(s: string): string[] {
  return s
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export interface CanonicalizeOptions {
  // When a single-token person cannot be bound to a multi-token mention in
  // the same transcript, scope its canonical form with this suffix so it
  // does not merge across transcripts. Pass the videoId.
  transcriptId: string;
  // Drop single-token persons that never appear as part of a multi-token
  // mention in the transcript. Default false (we keep them scoped instead).
  dropUnboundFirstNames?: boolean;
  // Optional dataDir for sourcing the organization_aliases.tsv side-loader.
  dataDir?: string;
}

export function canonicalizeNerMentions(
  mentions: NerMention[],
  opts: CanonicalizeOptions,
): NerMention[] {
  const transcriptId = opts.transcriptId;
  const dropUnbound = opts.dropUnboundFirstNames ?? false;

  // Build per-transcript alias map for persons: token (lowercased) → set of
  // multi-token canonical forms that contain it.
  const tokenToLong = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (m.type !== "person") continue;
    const toks = tokens(m.surface);
    if (toks.length < 2) continue;
    const canonicalLong = toks.join(" ");
    for (const t of toks) {
      const key = t.toLowerCase();
      if (PERSON_STOPWORDS.has(key)) continue;
      if (!tokenToLong.has(key)) tokenToLong.set(key, new Set());
      tokenToLong.get(key)!.add(canonicalLong);
    }
  }

  const out: NerMention[] = [];
  for (const m of mentions) {
    if (m.type === "person") {
      const toks = tokens(m.surface);
      // Drop stopword-only mentions (e.g. "God", "Dad").
      if (toks.every((t) => PERSON_STOPWORDS.has(t.toLowerCase()))) continue;
      if (toks.length >= 2) {
        // Multi-token: canonical is just the cleaned surface.
        out.push({ ...m, canonical: toks.join(" ") });
        continue;
      }
      // Single-token: try to bind to a unique multi-token form.
      const key = toks[0].toLowerCase();
      const candidates = tokenToLong.get(key);
      if (candidates && candidates.size === 1) {
        const [long] = [...candidates];
        out.push({ ...m, canonical: long });
        continue;
      }
      if (dropUnbound) continue;
      // Unbound: scope to transcript so it does not merge globally.
      out.push({ ...m, canonical: `${toks[0]} #${transcriptId}` });
      continue;
    }

    if (m.type === "location") {
      const canonical = LOCATION_ALIAS.get(m.surface.trim().toLowerCase());
      if (canonical) {
        out.push({ ...m, canonical });
        continue;
      }
      out.push({ ...m });
      continue;
    }

    if (m.type === "organization") {
      const canonical = orgAlias(opts.dataDir).get(m.surface.trim().toLowerCase());
      if (canonical) {
        out.push({ ...m, canonical });
        continue;
      }
      out.push({ ...m });
      continue;
    }

    // Other types: pass through unchanged.
    out.push({ ...m });
  }
  return out;
}
