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
import { colors } from "../theme";
import type { ClaimContradiction, ClaimsIndexEntry } from "../types";
import type { ClaimsBundle } from "./facets/claims-duck";

// 12% alpha overlay used as the soft tinted background behind each
// stance panel. Same hue as the stance border, eight times lighter.
function tintedBg(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

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
  const hue = stance ? colors.stance[stance as keyof typeof colors.stance] : undefined;
  if (!hue) {
    return {
      bg: "transparent", border: "rgba(0,0,0,0.2)",
      fg: "text.secondary", label: "—",
    };
  }
  return {
    bg: tintedBg(hue), border: hue, fg: hue,
    label: (stance ?? "").toUpperCase(),
  };
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
      border: { xs: "2px solid", md: "1px solid" },
      borderColor: { xs: "text.secondary", md: "divider" },
      borderRadius: { xs: 1.5, md: 1 },
      p: { xs: 1.25, md: 1.5 },
      mb: { xs: 2, md: 1.5 },
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
        color: "common.white",
        display: "flex", alignItems: "center", gap: 1,
      }}>
        <Typography sx={{
          fontSize: { xs: 12, sm: 11 }, fontWeight: 700, letterSpacing: 1.5,
        }}>
          {tint.label}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography sx={{ fontSize: { xs: 11, sm: 10 }, opacity: 0.9 }}>
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
