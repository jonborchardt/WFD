// Parse the typed-contradicts prefix from a dependency rationale.
//
// Plan 04 §A (plans2/04-contradictions-v2.md). Schema v1 stays put —
// the subkind travels inside the `rationale` string as a leading
// `[logical]` / `[debunks]` / `[alternative]` / `[undercuts]` prefix
// produced by the Plan 03 v2 claim-extraction prompt.
//
// Downstream code (detector + propagation) calls this helper rather
// than parsing inline so the prefix grammar lives in one place.

export type ContradictsSubkind =
  | "logical"      // strictly cannot both be true
  | "debunks"      // A presents evidence B is false
  | "alternative"  // A and B are competing primary explanations
  | "undercuts";   // A reduces B's probative value but both can be technically true

const PREFIX_RE = /^\s*\[(logical|debunks|alternative|undercuts)\]\s*/i;

// Returns the tag (lowercased) if rationale begins with a known prefix,
// otherwise undefined. Unknown or missing → undefined; caller decides
// what the default is (v1 claim files without prefixes are treated as
// "logical" for back-compat in the detector).
export function parseContradictsSubkind(
  rationale: string | undefined,
): ContradictsSubkind | undefined {
  if (!rationale) return undefined;
  const m = PREFIX_RE.exec(rationale);
  if (!m) return undefined;
  const tag = m[1].toLowerCase();
  if (
    tag === "logical" ||
    tag === "debunks" ||
    tag === "alternative" ||
    tag === "undercuts"
  ) {
    return tag;
  }
  return undefined;
}

// Strip the prefix and return the remaining rationale body. Useful for
// UI rendering — the prefix is an encoding artifact, not user-facing copy.
export function stripContradictsSubkind(rationale: string): string {
  return rationale.replace(PREFIX_RE, "").trim();
}
