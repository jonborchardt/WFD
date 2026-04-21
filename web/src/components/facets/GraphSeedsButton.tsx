// "graph these" button — ships the currently-filtered claim IDs to
// the argument map via `?kind=claim&seeds=id1,id2,…`. The graph page
// reads that multi-seed param on mount (see ClaimGraphPage).
//
// Caps the seed count for graph legibility and URL length; when the
// user's filter exceeds the cap we still navigate but mark it so the
// tooltip explains the truncation.

import { Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { GRAPH_SEED_CAP } from "../../lib/facet-helpers";

interface Props {
  // Full set of claim IDs the user wants to graph. The component
  // caps + dedupes internally so callers can pass raw lists
  // (including both sides of contradiction pairs).
  claimIds: string[];
  // Optional override label. Defaults to "graph these (N)".
  label?: string;
}

export function GraphSeedsButton({ claimIds, label }: Props) {
  const nav = useNavigate();
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of claimIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
    if (deduped.length >= GRAPH_SEED_CAP) break;
  }
  const truncated = seen.size >= GRAPH_SEED_CAP && claimIds.length > deduped.length;
  const disabled = deduped.length === 0;
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={disabled}
      onClick={() => {
        const qs = new URLSearchParams({
          kind: "claim",
          seeds: deduped.join(","),
        });
        if (truncated) qs.set("capped", "1");
        nav(`/argument-map?${qs.toString()}`);
      }}
      title={truncated
        ? `capped to ${GRAPH_SEED_CAP} claims for graph legibility`
        : undefined}
    >
      {label ?? "graph these"}
    </Button>
  );
}
