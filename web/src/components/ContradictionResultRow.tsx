// Contradiction result row rendered on the Contradictions page.
// Two stance-tinted panels side by side, each with a colored
// header banner (ASSERTS/DENIES + claim kind), hero claim text,
// truth bar, and muted full-title video link. A subordinated
// metadata footer below carries the contradiction-level data
// (kind, match reason, shared entities, ⋯ menu).

import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Chip, Link as MuiLink, Stack, Typography,
} from "@mui/material";
import { TruthBar } from "./TruthBar";
import { ContradictionMenu } from "./ContradictionMenu";
import type { ClaimContradiction, ClaimsIndexEntry } from "../types";
import type { ClaimsBundle } from "./facets/claims-duck";

export interface ContradictionResultRowProps {
  cx: ClaimContradiction;
  bundle: ClaimsBundle;
  nav: ReturnType<typeof useNavigate>;
  onMutated: () => void;
}

// Stance colors — green for asserts, red for denies, amber for
// uncertain, purple for steelman. Carries the "these two claims
// take opposite positions" signal visually.
export function stanceTint(stance?: string | null): {
  bg: string; border: string; fg: string; label: string;
} {
  switch (stance) {
    case "asserts":
      return {
        bg: "rgba(46, 125, 50, 0.12)", border: "#2e7d32",
        fg: "#2e7d32", label: "ASSERTS",
      };
    case "denies":
      return {
        bg: "rgba(211, 47, 47, 0.12)", border: "#d32f2f",
        fg: "#d32f2f", label: "DENIES",
      };
    case "uncertain":
      return {
        bg: "rgba(245, 124, 0, 0.12)", border: "#f57c00",
        fg: "#f57c00", label: "UNCERTAIN",
      };
    case "steelman":
      return {
        bg: "rgba(94, 53, 177, 0.12)", border: "#5e35b1",
        fg: "#5e35b1", label: "STEELMAN",
      };
    default:
      return {
        bg: "transparent", border: "rgba(0,0,0,0.2)",
        fg: "text.secondary", label: "—",
      };
  }
}

export function ContradictionResultRow(props: ContradictionResultRowProps) {
  const { cx, bundle, nav, onMutated } = props;
  const left = bundle.claimsById.get(cx.left);
  const right = bundle.claimsById.get(cx.right);
  return (
    <Frame>
      <Box sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gap: 2,
      }}>
        <StancePanel claim={left} id={cx.left} bundle={bundle} nav={nav} />
        <StancePanel claim={right} id={cx.right} bundle={bundle} nav={nav} />
      </Box>
      <Box sx={{ mt: 1, opacity: 0.7 }}>
        <MutedMeta cx={cx} nav={nav} onMutated={onMutated} />
      </Box>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <Box sx={{
      border: "1px solid", borderColor: "divider",
      borderRadius: 1, p: 1.5, mb: 1.5,
    }}>
      {children}
    </Box>
  );
}

export interface StancePanelProps {
  claim: ClaimsIndexEntry | undefined;
  id: string;
  bundle: ClaimsBundle;
  nav: ReturnType<typeof useNavigate>;
}

export function StancePanel({ claim, id, bundle, nav }: StancePanelProps) {
  if (!claim) {
    return (
      <Box sx={{
        flex: 1, p: 1, backgroundColor: "action.hover", borderRadius: 1,
      }}>
        <Typography variant="caption" color="text.secondary">
          {id} (missing from index)
        </Typography>
      </Box>
    );
  }
  const meta = bundle.videosById.get(claim.videoId);
  const videoTitle = meta?.title ?? claim.videoId;
  const tint = stanceTint(claim.hostStance);
  return (
    <Box
      sx={{
        borderRadius: 1, overflow: "hidden", cursor: "pointer",
        backgroundColor: tint.bg,
        "&:hover": { filter: "brightness(1.05)" },
      }}
      onClick={() => nav(`/claim/${encodeURIComponent(claim.id)}`)}
    >
      <Box sx={{
        px: 1.25, py: 0.5,
        backgroundColor: tint.border,
        color: "#fff",
        display: "flex", alignItems: "center", gap: 1,
      }}>
        <Typography sx={{
          fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
        }}>
          {tint.label}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography sx={{ fontSize: 10, opacity: 0.9 }}>
          {claim.kind}
        </Typography>
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Typography variant="body2" sx={{ mb: 0.75 }}>
          {claim.text}
        </Typography>
        <TruthBar
          value={claim.derivedTruth ?? claim.directTruth ?? null}
          source={claim.truthSource}
          label="truth"
        />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
          <MuiLink
            component="button"
            variant="caption"
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
            {videoTitle}
          </MuiLink>
        </Stack>
      </Box>
    </Box>
  );
}

// Contradiction-level metadata that sits below the two panels:
// pair/cross-video kind, match reason, shared-entity chips, and
// the ⋯ mutation menu. Rendered at 0.7 opacity by the caller.
function MutedMeta({
  cx, nav, onMutated,
}: Pick<ContradictionResultRowProps, "cx" | "nav" | "onMutated">) {
  const sharedCount = cx.sharedEntities?.length ?? 0;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        flexWrap: "wrap", alignItems: "center",
        fontSize: 11, color: "text.secondary",
      }}
    >
      <Typography variant="caption" sx={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
      }}>
        {cx.kind}
      </Typography>
      {cx.matchReason && (
        <Typography variant="caption">· via {cx.matchReason}</Typography>
      )}
      {sharedCount > 0 && (
        <Typography variant="caption">· {sharedCount} shared</Typography>
      )}
      {cx.similarity !== undefined && (
        <Typography variant="caption">
          · jaccard {cx.similarity.toFixed(2)}
        </Typography>
      )}
      {(cx.sharedEntities ?? []).slice(0, 4).map((e) => (
        <Chip
          key={e}
          size="small"
          variant="outlined"
          label={e}
          clickable
          onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
          sx={{ fontSize: 10, height: 20 }}
        />
      ))}
      {sharedCount > 4 && (
        <Typography variant="caption">+{sharedCount - 4} more</Typography>
      )}
      <Box sx={{ flexGrow: 1 }} />
      <ContradictionMenu
        leftId={cx.left}
        rightId={cx.right}
        isCustom={cx.kind === "manual"}
        onMutated={onMutated}
      />
    </Stack>
  );
}
