import { useState } from "react";
import { Box, Chip, Typography, Link, Collapse, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { TruthBar } from "./TruthBar";
import { ClaimMenu } from "./ClaimMenu";
import { deepLink, fmtTimestamp } from "../lib/format";
import type {
  Claim,
  ClaimContradiction,
  ClaimDependency,
  TruthSource,
} from "../types";

const KIND_COLOR: Record<string, string> = {
  empirical: "#1976d2",
  historical: "#6d4c41",
  speculative: "#8e24aa",
  opinion: "#ef6c00",
  definitional: "#00838f",
};

interface Props {
  videoId: string;
  claim: Claim;
  // Derived fields supplied by the parent if the corpus index has been
  // loaded. Optional — the per-video file alone is enough to render a row.
  derivedTruth?: number | null;
  truthSource?: TruthSource;
  overrideRationale?: string;
  // Inbound deps (claims that depend on this one). Outbound deps live on
  // the claim itself.
  inboundDeps?: ClaimDependency[];
  // Contradiction records that reference this claim on either side.
  contradictions?: ClaimContradiction[];
}

export function ClaimRow({
  videoId,
  claim,
  derivedTruth,
  truthSource,
  overrideRationale,
  inboundDeps,
  contradictions,
}: Props) {
  const nav = useNavigate();
  const [showWhy, setShowWhy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const truthValue =
    truthSource === "override" || derivedTruth !== null && derivedTruth !== undefined
      ? derivedTruth
      : claim.directTruth;
  const source: TruthSource =
    truthSource ??
    (claim.directTruth !== null && claim.directTruth !== undefined
      ? "direct"
      : "uncalibrated");

  return (
    <Box
      sx={{
        border: "1px solid #e0e0e0",
        borderRadius: 1,
        p: 1.5,
        mb: 1,
        position: "relative",
      }}
      id={`claim-${claim.id}`}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap" }}>
        <Chip
          size="small"
          label={claim.kind}
          sx={{
            backgroundColor: KIND_COLOR[claim.kind] ?? "#757575",
            color: "white",
            fontSize: "0.7rem",
          }}
        />
        {claim.hostStance && (
          <Chip
            size="small"
            label={`host: ${claim.hostStance}`}
            variant="outlined"
            sx={{ fontSize: "0.7rem" }}
          />
        )}
        {claim.inVerdictSection && (
          <Chip size="small" label="verdict" variant="outlined" sx={{ fontSize: "0.7rem" }} />
        )}
        {contradictions && contradictions.length > 0 && (
          <Chip
            size="small"
            label={`⚠ ${contradictions.length} contradiction${contradictions.length > 1 ? "s" : ""}`}
            sx={{ backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.7rem" }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <ClaimMenu
          claimId={claim.id}
          hasOverride={truthSource === "override"}
          onMutated={() => window.location.reload()}
        />
      </Stack>

      <Typography variant="body2" sx={{ mb: 1 }}>
        {claim.text}
      </Typography>

      <Stack spacing={0.25}>
        <TruthBar value={truthValue} source={source} label="truth" />
        <TruthBar value={claim.confidence} label="confidence" />
      </Stack>

      {overrideRationale && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          override: {overrideRationale}
        </Typography>
      )}

      {claim.entities.length > 0 && (
        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            entities:
          </Typography>
          {claim.entities.map((k) => (
            <Chip
              key={k}
              size="small"
              variant="outlined"
              clickable
              label={k}
              onClick={() => nav(`/entity/${encodeURIComponent(k)}`)}
              sx={{ fontSize: "0.7rem" }}
            />
          ))}
        </Box>
      )}

      <Box sx={{ mt: 1 }}>
        <Link
          component="button"
          variant="caption"
          onClick={() => setShowEvidence((v) => !v)}
          underline="hover"
        >
          {showEvidence ? "▾" : "▸"} evidence ({claim.evidence.length})
        </Link>
        <Collapse in={showEvidence}>
          <Box sx={{ mt: 0.5, pl: 1.5, borderLeft: "2px solid #eee" }}>
            {claim.evidence.map((ev, i) => (
              <Box key={i} sx={{ mb: 0.75 }}>
                <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                  “{ev.quote}”
                </Typography>
                <Link
                  href={deepLink(videoId, ev.timeStart)}
                  target="_blank"
                  rel="noopener"
                  variant="caption"
                >
                  [{fmtTimestamp(ev.timeStart)}]
                </Link>
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>

      {((claim.dependencies && claim.dependencies.length > 0) ||
        (inboundDeps && inboundDeps.length > 0)) && (
        <Box sx={{ mt: 0.75, display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            deps:
          </Typography>
          {(claim.dependencies ?? []).map((d, i) => (
            <Chip
              key={`out-${i}`}
              size="small"
              variant="outlined"
              clickable
              label={`${d.kind} → ${shortId(d.target)}`}
              onClick={() => scrollToClaim(d.target)}
              sx={{ fontSize: "0.7rem" }}
            />
          ))}
          {(inboundDeps ?? []).map((d, i) => (
            <Chip
              key={`in-${i}`}
              size="small"
              variant="outlined"
              clickable
              label={`${d.target ? shortId(d.target) : "?"} ${d.kind} → this`}
              onClick={() => scrollToClaim(d.target)}
              sx={{ fontSize: "0.7rem", opacity: 0.75 }}
            />
          ))}
        </Box>
      )}

      <Box sx={{ mt: 0.75 }}>
        <Link
          component="button"
          variant="caption"
          onClick={() => setShowWhy((v) => !v)}
          underline="hover"
        >
          {showWhy ? "hide rationale" : "why?"}
        </Link>
        <Collapse in={showWhy}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {claim.rationale}
          </Typography>
        </Collapse>
      </Box>

      {contradictions && contradictions.length > 0 && (
        <Box sx={{ mt: 0.75, pl: 1.5, borderLeft: "2px solid #ffb74d" }}>
          {contradictions.map((c, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{ display: "block" }}>
              ⚠ {c.summary}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

function shortId(id: string): string {
  const i = id.lastIndexOf(":");
  return i > 0 ? id.slice(i + 1) : id;
}

function scrollToClaim(id: string): void {
  const el = document.getElementById(`claim-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}
