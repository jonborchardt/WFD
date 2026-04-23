import { useMemo } from "react";
import { Box, Typography, Alert } from "@mui/material";
import { ClaimDetailCard } from "./ClaimDetailCard";
import type {
  PersistedClaims,
  ClaimsIndexEntry,
  ClaimContradiction,
  ClaimDependency,
} from "../types";

interface Props {
  videoId: string;
  claims: PersistedClaims | null;
  indexEntries?: ClaimsIndexEntry[];          // this video's claims from the corpus index
  contradictions?: ClaimContradiction[];      // touching this video
  corpusIndex?: ClaimsIndexEntry[];           // full corpus (for counterfactual)
  onMutated?: () => void;
}

// Per-video claims section. Renders nothing (apart from a muted hint) if
// the video has no claim file. Inbound deps + cross-video contradiction
// info are derived once and passed to each ClaimDetailCard.
export function ClaimsPanel({ videoId, claims, indexEntries, contradictions, corpusIndex, onMutated }: Props) {
  const indexById = useMemo(() => {
    const m = new Map<string, ClaimsIndexEntry>();
    for (const e of indexEntries ?? []) m.set(e.id, e);
    return m;
  }, [indexEntries]);

  const inboundByClaim = useMemo(() => {
    const m = new Map<string, ClaimDependency[]>();
    if (!claims) return m;
    for (const c of claims.claims) {
      for (const d of c.dependencies ?? []) {
        const list = m.get(d.target) ?? [];
        list.push({ target: c.id, kind: d.kind, rationale: d.rationale ?? null });
        m.set(d.target, list);
      }
    }
    return m;
  }, [claims]);

  const contradictionsByClaim = useMemo(() => {
    const m = new Map<string, ClaimContradiction[]>();
    for (const cx of contradictions ?? []) {
      for (const side of [cx.left, cx.right]) {
        const list = m.get(side) ?? [];
        list.push(cx);
        m.set(side, list);
      }
    }
    return m;
  }, [contradictions]);

  if (!claims) {
    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="h6">Claims</Typography>
        <Typography variant="body2" color="text.secondary">
          no claims extracted for this video yet.
        </Typography>
      </Box>
    );
  }

  const withDerived = claims.claims.filter((c) => {
    const idx = indexById.get(c.id);
    return idx?.derivedTruth !== null && idx?.derivedTruth !== undefined;
  }).length;
  const totalContradictions = claims.claims.reduce(
    (n, c) => n + (contradictionsByClaim.get(c.id)?.length ?? 0),
    0,
  );

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Claims{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {claims.claims.length} claims · {withDerived} with derived truth · {totalContradictions} contradiction link{totalContradictions === 1 ? "" : "s"}
        </Typography>
      </Typography>

      {claims._stale && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Claims file is stale — {claims._stale.reason} (marked{" "}
          {new Date(claims._stale.since).toLocaleString()}). Re-run extraction
          to refresh.
        </Alert>
      )}

      {claims.claims.map((c) => {
        const idx = indexById.get(c.id);
        return (
          <ClaimDetailCard
            key={c.id}
            videoId={videoId}
            claim={{ ...c, tags: idx?.tags ?? c.tags }}
            derivedTruth={idx?.derivedTruth ?? null}
            truthSource={idx?.truthSource}
            overrideRationale={idx?.overrideRationale}
            inboundDeps={inboundByClaim.get(c.id)}
            contradictions={contradictionsByClaim.get(c.id)}
            counterEvidence={idx?.counterEvidence}
            corpusIndex={corpusIndex}
            onMutated={onMutated}
          />
        );
      })}
    </Box>
  );
}
