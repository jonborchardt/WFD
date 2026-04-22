// Per-video claim records produced by an AI session over the
// transcript + entities + relations. Schema lives here; persist/validate
// live in sibling files. NER files (data/entities/<id>.json,
// data/relations/<id>.json) remain immutable — claims are a new, additive
// per-video output written to data/claims/<id>.json.

export type ClaimId = string;  // "<videoId>:c_0001"

export type ClaimKind =
  | "empirical"
  | "historical"
  | "speculative"
  | "opinion"
  | "definitional";

export type DependencyKind =
  | "supports"
  | "contradicts"
  | "presupposes"
  | "elaborates";

export type HostStance = "asserts" | "denies" | "uncertain" | "steelman";

export interface ClaimEvidence {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
  quote: string;     // exact transcript slice — validator enforces
}

export interface ClaimDependency {
  target: ClaimId;
  kind: DependencyKind;
  rationale?: string;
}

export interface Claim {
  id: ClaimId;
  videoId: string;
  text: string;
  kind: ClaimKind;
  entities: string[];          // entity keys, coref-resolved (label:canonical)
  relationships: string[];     // relationship ids that evidence this claim (may be empty)
  evidence: ClaimEvidence[];
  confidence: number;          // 0..1 — AI's certainty claim is ASSERTED in transcript
  directTruth?: number;        // 0..1 — AI's best guess at truthiness, if confident enough
  rationale: string;
  dependencies?: ClaimDependency[];
  inVerdictSection?: boolean;
  hostStance?: HostStance;
  // Free-form short tags for search / grouping. Lowercase kebab-case by
  // convention (e.g. ["ufo", "area-51", "government-cover-up"]). AI may
  // seed these during claim extraction; admin can override via
  // aliases.json `claimTagOverrides[]`.
  tags?: string[];
}

export interface PersistedClaims {
  schemaVersion: 1;
  transcriptId: string;
  generatedAt: string;
  generator: string;
  claims: Claim[];
}

export const CLAIMS_SCHEMA_VERSION = 1 as const;
