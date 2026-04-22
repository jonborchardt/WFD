// Shared dependency-card row. Used both inline inside the claim
// detail card's collapsible "deps" section and on the Claim Detail
// page's "Non-contradictory related claims" panel. Renders a card
// with a truth-colored left border (matching the target claim's
// truth), the target claim text as the body, and a meta row with
// the colored uppercase kind label + a TruthBar for the target.

import { Box, Stack, Typography } from "@mui/material";
import { TruthBar } from "./TruthBar";
import { truthSideColor } from "../lib/truth-palette";
import { claimRelationColor } from "../theme";
import type { ClaimsIndexEntry } from "../types";

export interface DepRowProps {
  direction: "in" | "out";
  kind: string;
  targetId: string;
  corpusIndex?: ClaimsIndexEntry[];
  onClick: () => void;
}

export function DepRow({
  direction, kind, targetId, corpusIndex, onClick,
}: DepRowProps) {
  const target = corpusIndex?.find((c) => c.id === targetId);
  const title = target?.text ?? targetId;
  const kColor = claimRelationColor(kind);
  const t = target
    ? (target.derivedTruth ?? target.directTruth ?? null)
    : null;
  return (
    <Box
      sx={{
        border: "1px solid", borderColor: "divider",
        borderLeft: `5px solid ${truthSideColor(t)}`,
        borderRadius: 1, p: 1.25, mb: 1,
        cursor: "pointer",
        opacity: direction === "in" ? 0.9 : 1,
        "&:hover": { backgroundColor: "action.hover" },
      }}
      onClick={onClick}
    >
      <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography sx={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          color: kColor, textTransform: "uppercase",
        }}>
          {kind}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          · {direction === "in" ? "from" : "to"}
        </Typography>
        {target && (
          <TruthBar
            value={t}
            source={target.truthSource}
            label="truth"
          />
        )}
      </Stack>
    </Box>
  );
}
