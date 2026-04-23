import { Link as RouterLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Box, Container, Link, Paper, Typography } from "@mui/material";
import { colors } from "../theme";

// Variant 3 — Numbers + concepts.
//
// A newsroom-style landing. Big stat tiles establish scale up top,
// each one explaining not just "how many" but "what this thing IS".
// Below, a three-column "what you can do here" triptych. The shortcut
// dashboard is compressed to a single row of quiet links.

const ACCENT = colors.brand.accent;

interface CorpusCounts {
  videos: number | null;
  claims: number | null;
  contradictions: number | null;
  agreements: number | null;
}

export function HomePage3() {
  const counts = useCorpusCounts();
  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
      <Box sx={{ textAlign: "center", mb: 5, mt: 2 }}>
        <Typography
          variant="overline"
          sx={{ color: ACCENT, letterSpacing: 2, fontWeight: 700 }}
        >
          THE WHY FILES · DATABASE
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: "2rem", md: "2.75rem" },
            fontWeight: 800,
            lineHeight: 1.15,
            mt: 1,
            maxWidth: 780,
            mx: "auto",
          }}
        >
          Four hundred episodes of fringe-topic video, turned into
          <Box component="span" sx={{ color: ACCENT }}> structured, searchable evidence.</Box>
        </Typography>
        <Typography
          variant="h6"
          color="text.secondary"
          sx={{ mt: 2, fontWeight: 400, maxWidth: 720, mx: "auto" }}
        >
          An independent research index of{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>
          . We don't decide what's true. We just make every claim
          traceable back to the exact line of transcript where it
          was said.
        </Typography>
      </Box>

      {/* Stat tiles — each includes a definition of the concept */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
          mb: 6,
        }}
      >
        <Stat
          n={counts.videos}
          label="videos ingested"
          body="Every episode's transcript pulled from YouTube, stored locally, and processed by the pipeline."
          to="/videos"
        />
        <Stat
          n={counts.claims}
          label="claims extracted"
          body="Thesis-level statements the host asserts — each with a single-sentence evidence quote and a truth score."
          to="/claims"
          accent
        />
        <Stat
          n={counts.contradictions}
          label="contradictions"
          body="Pairs of claims that can't both be true — inside one episode or across two. AI-verdicted before surfacing."
          to="/contradictions"
        />
        <Stat
          n={counts.agreements}
          label="cross-video agreements"
          body="Same thesis asserted in two different episodes. Positive corroboration, the flip side of contradictions."
          to="/cross-video-agreements"
        />
      </Box>

      {/* Triptych — what you can actually DO */}
      <Typography
        variant="overline"
        sx={{
          color: "text.secondary",
          letterSpacing: 2,
          fontWeight: 700,
          borderTop: 2,
          borderColor: "divider",
          pt: 2,
          display: "block",
        }}
      >
        what you can do here
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
          gap: 2,
          mt: 2,
          mb: 6,
        }}
      >
        <Action
          num="01"
          title="Find a claim"
          body="Search or browse thesis-level statements across the corpus. Filter by truth score, topic tag, host stance, or the kind of contradiction it triggers. Every row is a real proposition — not a keyword hit."
          linkLabel="Open the claim browser"
          to="/claims"
        />
        <Action
          num="02"
          title="Trace its evidence"
          body="Every claim carries a pointer to the exact transcript span that supports it. Click through to read the sentence, see the timestamp, and jump to the moment in the video. No claim floats without evidence."
          linkLabel="Pick a video"
          to="/videos"
        />
        <Action
          num="03"
          title="Surface disagreements"
          body="A semantic-similarity pass finds claim pairs that might disagree; a second AI pass verdicts each one. What you see is real contradiction, not noise. The flip side — cross-video agreement — gets its own page."
          linkLabel="See contradictions"
          to="/contradictions"
        />
      </Box>

      {/* Quiet link strip at the bottom */}
      <Box
        sx={{
          textAlign: "center",
          borderTop: 1,
          borderColor: "divider",
          pt: 3,
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Or jump straight in:
        </Typography>
        <Box sx={{ display: "inline-flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
          <Link component={RouterLink} to="/entity-graph" sx={{ fontWeight: 500 }}>
            entity graph →
          </Link>
          <Link component={RouterLink} to="/argument-map" sx={{ fontWeight: 500 }}>
            argument map →
          </Link>
          <Link component={RouterLink} to="/cross-video-agreements" sx={{ fontWeight: 500 }}>
            agreements →
          </Link>
        </Box>
      </Box>
    </Container>
  );
}

function Stat({
  n, label, body, to, accent,
}: {
  n: number | null;
  label: string;
  body: string;
  to: string;
  accent?: boolean;
}) {
  return (
    <Paper
      component={RouterLink}
      to={to}
      variant="outlined"
      sx={{
        display: "block",
        p: 2.5,
        borderRadius: 2,
        textDecoration: "none",
        color: "inherit",
        borderColor: accent ? ACCENT : "divider",
        borderLeft: accent ? 4 : 1,
        borderLeftColor: accent ? ACCENT : "divider",
        transition: "background-color 120ms, transform 120ms",
        "&:hover": {
          bgcolor: "action.hover",
          transform: "translateY(-2px)",
        },
      }}
    >
      <Typography
        sx={{
          fontSize: { xs: "2rem", md: "2.5rem" },
          fontWeight: 800,
          lineHeight: 1,
          color: accent ? ACCENT : "text.primary",
        }}
      >
        {n == null ? "—" : n.toLocaleString()}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, lineHeight: 1.5 }}>
        {body}
      </Typography>
    </Paper>
  );
}

function Action({
  num, title, body, linkLabel, to,
}: {
  num: string;
  title: string;
  body: string;
  linkLabel: string;
  to: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, height: "100%", display: "flex", flexDirection: "column" }}>
      <Typography
        sx={{
          fontSize: "0.85rem",
          fontWeight: 700,
          color: ACCENT,
          letterSpacing: 2,
          mb: 1,
        }}
      >
        {num}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1, lineHeight: 1.65 }}>
        {body}
      </Typography>
      <Link component={RouterLink} to={to} sx={{ mt: 2, fontWeight: 500 }}>
        {linkLabel} →
      </Link>
    </Paper>
  );
}

// Best-effort counts. If data/ isn't reachable, the component
// gracefully falls back to "—" rather than showing zeros.
function useCorpusCounts(): CorpusCounts {
  const [counts, setCounts] = useState<CorpusCounts>({
    videos: null, claims: null, contradictions: null, agreements: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
        const [catalog, claims, cx, cons] = await Promise.allSettled([
          fetch(base + "/data/catalog/videos.json").then(r => r.json()),
          fetch(base + "/data/claims/claims-index.json").then(r => r.json()),
          fetch(base + "/data/claims/contradictions.json").then(r => r.json()),
          fetch(base + "/data/claims/consonance.json").then(r => r.json()),
        ]);
        if (cancelled) return;
        setCounts({
          videos: catalog.status === "fulfilled"
            ? (Array.isArray(catalog.value) ? catalog.value.length : catalog.value?.videos?.length ?? null)
            : null,
          claims: claims.status === "fulfilled"
            ? (Array.isArray(claims.value) ? claims.value.length : claims.value?.claims?.length ?? null)
            : null,
          contradictions: cx.status === "fulfilled"
            ? (Array.isArray(cx.value) ? cx.value.length : cx.value?.contradictions?.length ?? null)
            : null,
          agreements: cons.status === "fulfilled"
            ? (Array.isArray(cons.value) ? cons.value.length : cons.value?.pairs?.length ?? null)
            : null,
        });
      } catch {
        // leave as null — dashes render.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return counts;
}

