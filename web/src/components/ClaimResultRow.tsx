// Claim result row rendered on the Claims page. Kind-colored kind
// label, truth-colored left border, hero claim text, muted meta
// row, entity chips footer. Click-through to the claim detail.

import { useNavigate } from "react-router-dom";
import {
  Box, Chip, Link as MuiLink, Stack, Tooltip, Typography,
} from "@mui/material";
import { TruthBar } from "./TruthBar";
import { entityChipSx } from "../lib/facet-helpers";
import { truthSideColor } from "../lib/truth-palette";
import { claimKindColor } from "../theme";
import type { ClaimsIndexEntry } from "../types";
import type { ClaimsBundle } from "./facets/claims-duck";

export interface ClaimResultRowProps {
  claim: ClaimsIndexEntry;
  nav: ReturnType<typeof useNavigate>;
  bundle: ClaimsBundle;
}

function truthNum(claim: ClaimsIndexEntry): number | null {
  const v = claim.derivedTruth ?? claim.directTruth ?? null;
  return v != null && Number.isFinite(v) ? v : null;
}

export function ClaimResultRow({ claim, nav, bundle }: ClaimResultRowProps) {
  const contradictions = bundle.contradictionCount.get(claim.id) ?? 0;
  const deps = bundle.depCounts.get(claim.id) ?? { in: 0, out: 0 };
  const meta = bundle.videosById.get(claim.videoId);
  const title = meta?.title ?? claim.videoId;
  const kColor = claimKindColor(claim.kind);
  return (
    <Box
      sx={{
        border: "1px solid", borderColor: "divider",
        borderLeft: `5px solid ${truthSideColor(truthNum(claim))}`,
        borderRadius: 1, p: 1.5, mb: 1, cursor: "pointer",
        "&:hover": { backgroundColor: "action.hover" },
      }}
      onClick={() => nav(`/claim/${encodeURIComponent(claim.id)}`)}
    >
      <Typography variant="body1" sx={{ mb: 1, fontWeight: 500 }}>
        {claim.text}
      </Typography>
      <Stack direction="row" spacing={2} sx={{
        mb: 0.75, alignItems: "center", flexWrap: "wrap",
      }}>
        <TruthBar
          value={claim.derivedTruth ?? claim.directTruth ?? null}
          source={claim.truthSource}
          label="truth"
          width={200}
          minLabelWidth={0}
        />
        {claim.confidence != null && (
          <Typography variant="caption" color="text.secondary" sx={{
            fontWeight: 500,
          }}>
            conf {claim.confidence.toFixed(2)}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{
        color: "text.secondary", alignItems: "center", flexWrap: "wrap",
      }}>
        <Typography variant="caption" sx={{
          color: kColor, fontWeight: 700, letterSpacing: 0.5,
          textTransform: "uppercase", fontSize: 10,
        }}>
          {claim.kind}
        </Typography>
        {claim.hostStance && (
          <Typography variant="caption">· host {claim.hostStance}</Typography>
        )}
        {claim.inVerdictSection && (
          <Typography variant="caption">· verdict</Typography>
        )}
        <Typography variant="caption">·</Typography>
        <MuiLink
          component="button" variant="caption"
          sx={{
            textAlign: "left", lineHeight: 1.3,
            color: "text.secondary",
            textDecorationColor: "currentColor",
            "&:hover": { color: "text.primary" },
          }}
          onClick={(e) => {
            e.stopPropagation();
            nav(`/video/${claim.videoId}`);
          }}
        >
          {title}
        </MuiLink>
        {contradictions > 0 && (
          <Typography variant="caption" sx={{ color: "warning.main" }}>
            · ⚠ {contradictions} contradiction{contradictions > 1 ? "s" : ""}
          </Typography>
        )}
        {(deps.in > 0 || deps.out > 0) && (
          <Tooltip
            arrow
            title={
              <Box sx={{ fontSize: 12, lineHeight: 1.4 }}>
                <Box sx={{ mb: 0.5 }}>
                  <strong>{deps.out} out</strong> — this claim
                  supports / contradicts / presupposes / elaborates{" "}
                  {deps.out === 1 ? "another claim" : "other claims"}
                </Box>
                <Box>
                  <strong>{deps.in} in</strong> —{" "}
                  {deps.in === 1 ? "another claim" : "other claims"}{" "}
                  point at this one (it supports, contradicts,
                  presupposes, or elaborates them)
                </Box>
              </Box>
            }
          >
            <Typography variant="caption" sx={{ cursor: "help", textDecoration: "underline dotted" }}>
              · {deps.out} out / {deps.in} in
            </Typography>
          </Tooltip>
        )}
      </Stack>
      {claim.entities.length > 0 && (
        <Box sx={{
          mt: 0.75, display: "flex", flexWrap: "wrap", gap: 0.5,
          alignItems: "center",
        }}>
          {claim.entities.slice(0, 6).map((k) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              clickable
              label={k}
              onClick={(e) => {
                e.stopPropagation();
                nav(`/entity/${encodeURIComponent(k)}`);
              }}
              sx={{ fontSize: "0.7rem", ...entityChipSx(k) }}
            />
          ))}
          {claim.entities.length > 6 && (
            <Typography variant="caption" color="text.secondary">
              +{claim.entities.length - 6} more
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
