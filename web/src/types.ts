// Types for the static public site.

export interface VideoRow {
  videoId: string;
  title?: string;
  channel?: string;
  channelId?: string;
  description?: string;
  publishDate?: string;
  uploadDate?: string;
  category?: string;
  status?: string;
  sourceUrl?: string;
  transcriptPath?: string;
  thumbnailUrl?: string;
  lengthSeconds?: number;
  viewCount?: number;
  isLiveContent?: boolean;
  errorReason?: string;
  lastError?: string;
  keywords?: string[];
  stages?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface EntityIndexEntry {
  id: string;
  type: string;
  canonical: string;
  videoCount: number;
  mentionCount: number;
}

export interface TranscriptSpan {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
}

export interface EntityVideosIndex {
  [entityId: string]: { videoId: string; mentions: TranscriptSpan[] }[];
}

export interface TranscriptCue {
  start: number;
  end?: number;
  text: string;
}

export interface Transcript {
  id: string;
  cues: TranscriptCue[];
}

// Per-video persisted entities (schemaVersion 1)
export interface PersistedMention {
  id: string;
  label: string;
  surface: string;
  canonical: string;
  span: TranscriptSpan;
  score: number;
}

export interface PersistedEntities {
  schemaVersion: number;
  transcriptId: string;
  model: string;
  mentions: PersistedMention[];
}

// Per-video persisted relations (schemaVersion 1)
export interface PersistedEdge {
  id: string;
  predicate: string;
  subjectMentionId: string;
  objectMentionId: string;
  score: number;
  evidence: TranscriptSpan;
}

export interface PersistedRelations {
  schemaVersion: number;
  transcriptId: string;
  model: string;
  edges: PersistedEdge[];
}

// Graph types
export interface GraphNode {
  id: string;
  type: string;
  canonical: string;
  weight: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  count: number;
}

// Adapted NLP for display
export interface DisplayEntity {
  id: string;
  type: string;
  canonical: string;
  mentions: TranscriptSpan[];
}

export interface DisplayRelationship {
  id: string;
  subjectId: string;
  objectId: string;
  predicate: string;
  confidence: number;
  evidence: TranscriptSpan;
}

export interface VideoNlp {
  entities: DisplayEntity[];
  relationships: DisplayRelationship[];
}

// ---- Claims (Plan 2 / 3 / 5) -----------------------------------------

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

export type TruthSource = "direct" | "derived" | "override" | "uncalibrated";

export interface ClaimEvidence {
  transcriptId: string;
  charStart: number;
  charEnd: number;
  timeStart: number;
  timeEnd: number;
  quote: string;
}

export interface ClaimDependency {
  target: string;
  kind: DependencyKind;
  rationale?: string | null;
}

export interface Claim {
  id: string;
  videoId: string;
  text: string;
  kind: ClaimKind;
  entities: string[];
  relationships: string[];
  evidence: ClaimEvidence[];
  confidence: number;
  directTruth?: number | null;
  rationale: string;
  dependencies?: ClaimDependency[];
  inVerdictSection?: boolean;
  hostStance?: HostStance | null;
  tags?: string[];
}

export interface PersistedClaims {
  schemaVersion: 1;
  transcriptId: string;
  generatedAt: string;
  generator: string;
  claims: Claim[];
  _stale?: { since: string; reason: string };
}

// Inbound "another claim in the same video calls this one into question"
// edge. Populated by the claim-indexes stage from intra-video
// `contradicts` deps whose subkind is `alternative` or `undercuts`.
// Semantically not a standoff — the host's own verdict on a claim they
// themselves introduced, so displayed next to the target claim as
// "evidence against it" rather than on the contradictions page.
export interface CounterEvidenceEntry {
  fromClaimId: string;
  kind: "alternative" | "undercuts";
  rationale: string | null;
  fromDirectTruth: number | null;
  fromHostStance: HostStance | null;
}

export interface ClaimsIndexEntry extends Omit<Claim,
  "evidence" | "rationale" | "dependencies" | "tags"
> {
  derivedTruth: number | null;
  truthSource: TruthSource;
  overrideRationale?: string;
  dependencies: ClaimDependency[];
  tags: string[];
  fieldOverrides?: Array<"text" | "kind" | "hostStance" | "rationale" | "tags">;
  counterEvidence?: CounterEvidenceEntry[];
}

export interface ClaimsIndexFile {
  generatedAt: string;
  videoCount: number;
  claimCount: number;
  propagation: {
    iterations: number;
    maxDelta: number;
    claimsWithDerived: number;
  };
  claims: ClaimsIndexEntry[];
}

export interface DependencyGraphFile {
  generatedAt: string;
  edges: Array<{
    from: string;
    to: string;
    kind: DependencyKind;
    rationale: string | null;
  }>;
  edgeCount: number;
}

export type ContradictsSubkind = "logical" | "debunks" | "alternative" | "undercuts";

export type ContradictionVerifyVerdict =
  | "LOGICAL-CONTRADICTION"
  | "DEBUNKS"
  | "UNDERCUTS"
  | "ALTERNATIVE"
  | "COMPLEMENTARY"
  | "IRRELEVANT"
  | "SAME-CLAIM";

export interface ClaimContradiction {
  kind: "pair" | "broken-presupposition" | "cross-video" | "manual";
  subkind?: ContradictsSubkind;
  left: string;
  right: string;
  sharedEntities?: string[];
  similarity?: number;
  matchReason?: "jaccard" | "strong-overlap" | "cosine";
  summary: string;
  verified?: null | {
    verdict: ContradictionVerifyVerdict;
    reasoning?: string;
    by?: "ai" | "operator";
  };
}

export interface ContradictionsFile {
  generatedAt: string;
  total: number;
  byKind: Record<string, number>;
  verifiedDropped?: { total: number; byVerdict: Record<string, number> };
  contradictions: ClaimContradiction[];
}

// Plan 04 §D4 — SAME-CLAIM pairs promoted to cross-video agreements.
export interface ConsonanceFile {
  schemaVersion: 1;
  generatedAt: string;
  count: number;
  // Shape matches ClaimContradiction for reuse of existing row components.
  agreements: ClaimContradiction[];
}

export interface EdgeTruthEntry {
  edgeId: string;
  truth: number;
  claimCount: number;
  supportingClaimIds: string[];
}

export interface EdgeTruthFile {
  generatedAt: string;
  edgeCount: number;
  edges: Record<string, EdgeTruthEntry>;
}

export interface CatalogColumn {
  key: string;
  label: string;
  menuLabel?: string;
  default: boolean;
  /**
   * Visible on phone (xs) viewports. Tables prune down to these at xs
   * so a 6-column layout doesn't produce horizontal scroll on 375 px.
   * Defaults to false when unset.
   */
  mobileDefault?: boolean;
  headSx?: Record<string, unknown>;
  cellSx?: Record<string, unknown>;
  render: (r: VideoRow) => React.ReactNode;
}
