import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Button, Container, Link, Paper, Typography } from "@mui/material";
import { colors } from "../theme";

// Variant 5 — Guided 4-step tour.
//
// The dashboard is replaced by a literal tutorial: four numbered
// steps, each with a tiny illustration, an explanation of what the
// concept means, and a "try this step" link that deep-links to a
// representative page. Reader leaves having mentally mapped the
// whole site without ever seeing a card grid.

const ACCENT = colors.brand.accent;

export function HomePage5() {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
      <Box sx={{ textAlign: "center", mb: 6 }}>
        <Typography
          variant="overline"
          sx={{ color: ACCENT, letterSpacing: 2, fontWeight: 700 }}
        >
          how to use this site · in four steps
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: "2rem", md: "2.75rem" },
            fontWeight: 800,
            mt: 1, mb: 2,
            lineHeight: 1.15,
          }}
        >
          Start from a topic. End with the receipts.
        </Typography>
        <Typography
          variant="h6"
          color="text.secondary"
          sx={{ fontWeight: 400, maxWidth: 680, mx: "auto", lineHeight: 1.55 }}
        >
          An independent index of{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>
          . Every episode's transcript, turned into structured data:
          entities, relationships, claims, contradictions. Here's the
          four-step path through it.
        </Typography>
      </Box>

      <Step
        n={1}
        title="Pick a topic"
        body="The catalog is faceted by person, place, organization, event, and year. Filter down to the videos that mention what you care about, then drill into one."
        illustration={<IllPick />}
        link={{ to: "/videos", label: "Browse the catalog" }}
      />
      <Step
        n={2}
        title="See what was claimed"
        body="Each video gets broken into thesis-level claims — the statements the host is actually asserting. Every claim has a truth score, a host-stance (asserts / denies / debunks), and dependency links to other claims."
        illustration={<IllClaim />}
        link={{ to: "/claims", label: "Open the claim browser" }}
      />
      <Step
        n={3}
        title="Read the evidence"
        body="Every claim points back to a specific span of transcript. Click through and you land on the exact sentence with a timestamp — no quote is orphaned from its source."
        illustration={<IllEvidence />}
        link={{ to: "/videos", label: "Pick any video to see evidence links" }}
      />
      <Step
        n={4}
        title="Compare episodes"
        body="A detector finds claims across different episodes that might disagree. A second AI pass verdicts each candidate. What you see is real contradiction — and the flip side, cross-video agreement, gets its own page."
        illustration={<IllCompare />}
        link={{ to: "/contradictions", label: "See every contradiction" }}
      />

      <Paper
        variant="outlined"
        sx={{
          mt: 6, p: 3,
          borderRadius: 2,
          textAlign: "center",
          borderTop: 4,
          borderTopColor: ACCENT,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Already know what you want?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Skip the tour and jump to any of the power tools.
        </Typography>
        <Box sx={{ display: "inline-flex", gap: 1.5, flexWrap: "wrap", justifyContent: "center" }}>
          <Button component={RouterLink} to="/entity-graph" variant="outlined" size="small">
            Entity graph
          </Button>
          <Button component={RouterLink} to="/argument-map" variant="outlined" size="small">
            Argument map
          </Button>
          <Button component={RouterLink} to="/cross-video-agreements" variant="outlined" size="small">
            Cross-video agreements
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}

function Step({
  n, title, body, illustration, link,
}: {
  n: number;
  title: string;
  body: string;
  illustration: ReactNode;
  link: { to: string; label: string };
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "auto 1fr" },
        gap: { xs: 1.5, sm: 3 },
        mb: 4,
        alignItems: "stretch",
      }}
    >
      {/* big number column */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 0.5,
          minWidth: { sm: 80 },
        }}
      >
        <Typography
          sx={{
            fontSize: { xs: "2.5rem", sm: "3.5rem" },
            fontWeight: 900,
            lineHeight: 1,
            color: ACCENT,
            letterSpacing: "-0.04em",
          }}
        >
          {String(n).padStart(2, "0")}
        </Typography>
        <Box
          sx={{
            display: { xs: "none", sm: "block" },
            flex: 1,
            width: 2,
            bgcolor: "divider",
            mt: 1,
          }}
        />
      </Box>

      {/* body */}
      <Paper
        variant="outlined"
        sx={{
          p: 2.5, borderRadius: 2,
          display: "flex",
          gap: 2.5,
          flexDirection: { xs: "column", md: "row" },
          alignItems: { xs: "stretch", md: "center" },
        }}
      >
        <Box sx={{ flexShrink: 0 }}>{illustration}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
            {body}
          </Typography>
          <Link
            component={RouterLink}
            to={link.to}
            sx={{
              mt: 1.5, display: "inline-block",
              fontWeight: 500, fontSize: "0.9rem",
            }}
          >
            Try step {n}: {link.label} →
          </Link>
        </Box>
      </Paper>
    </Box>
  );
}

// — illustrations —
// Each ~120×84. Meant to read as a sketch of the UI you'll land
// on once you take this step.

function IllPick() {
  return (
    <svg width="120" height="84" viewBox="0 0 120 84">
      <rect x="6" y="6" width="108" height="14" rx="3" fill="#e3f2fd" stroke="#90caf9" />
      <rect x="10" y="11" width="40" height="4" rx="1" fill="#1976d2" />
      <rect x="6" y="28" width="108" height="8" rx="2" fill="#90caf9" />
      <rect x="6" y="42" width="78" height="8" rx="2" fill="#64b5f6" />
      <rect x="6" y="56" width="96" height="8" rx="2" fill="#42a5f5" />
      <rect x="6" y="70" width="52" height="8" rx="2" fill="#1e88e5" />
    </svg>
  );
}

function IllClaim() {
  return (
    <svg width="120" height="84" viewBox="0 0 120 84">
      <rect x="6" y="8" width="108" height="68" rx="4" fill="#fff" stroke="#cfd8dc" />
      <rect x="12" y="14" width="28" height="8" rx="2" fill="#1976d2" />
      <rect x="12" y="28" width="96" height="4" rx="1" fill="#eceff1" />
      <rect x="12" y="36" width="82" height="4" rx="1" fill="#eceff1" />
      <rect x="12" y="50" width="100" height="5" rx="2" fill="#eceff1" />
      <rect x="12" y="50" width="70" height="5" rx="2" fill="#66bb6a" />
      <rect x="12" y="62" width="100" height="5" rx="2" fill="#eceff1" />
      <rect x="12" y="62" width="44" height="5" rx="2" fill="#ffb74d" />
    </svg>
  );
}

function IllEvidence() {
  return (
    <svg width="120" height="84" viewBox="0 0 120 84">
      <rect x="6" y="6" width="108" height="72" rx="3" fill="#fafafa" stroke="#cfd8dc" />
      <rect x="10" y="10" width="40" height="4" rx="1" fill="#90a4ae" />
      <line x1="12" y1="22" x2="12" y2="74" stroke="#1976d2" strokeWidth="3" />
      <rect x="20" y="22" width="90" height="4" rx="1" fill="#37474f" />
      <rect x="20" y="30" width="70" height="4" rx="1" fill="#37474f" />
      <rect x="20" y="38" width="82" height="4" rx="1" fill="#37474f" />
      <circle cx="100" cy="60" r="10" fill="#1976d2" />
      <path d="M96 60 L104 60 M100 56 L100 64" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

function IllCompare() {
  return (
    <svg width="120" height="84" viewBox="0 0 120 84">
      <rect x="6" y="10" width="48" height="64" rx="3" fill="#fff3e0" stroke="#ffb74d" />
      <rect x="66" y="10" width="48" height="64" rx="3" fill="#fbe9e7" stroke="#ff8a65" />
      <rect x="12" y="16" width="36" height="4" rx="1" fill="#e65100" />
      <rect x="12" y="26" width="30" height="3" rx="1" fill="#bf360c" />
      <rect x="12" y="34" width="36" height="3" rx="1" fill="#bf360c" />
      <rect x="72" y="16" width="36" height="4" rx="1" fill="#d84315" />
      <rect x="72" y="26" width="30" height="3" rx="1" fill="#bf360c" />
      <rect x="72" y="34" width="36" height="3" rx="1" fill="#bf360c" />
      <path d="M54 50 L66 50" stroke="#d84315" strokeWidth="2.5" markerEnd="url(#hp5-ar)" />
      <path d="M66 60 L54 60" stroke="#d84315" strokeWidth="2.5" markerEnd="url(#hp5-al)" />
      <defs>
        <marker id="hp5-ar" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d84315" />
        </marker>
        <marker id="hp5-al" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d84315" />
        </marker>
      </defs>
    </svg>
  );
}
