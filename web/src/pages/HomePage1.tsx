import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Button, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { colors } from "../theme";

// Variant 1 — Narrative-first.
//
// The complaint on the baseline HomePage: "feels like jumping right
// into a dashboard." This variant solves it by pushing every card /
// shortcut below the fold. Above the fold is ONLY a large editorial
// hero + a long-form "what you're looking at" paragraph. Card grid
// is trimmed to four chip-style links tucked at the bottom.

const ACCENT = colors.brand.accent;

export function HomePage1() {
  return (
    <Box>
      {/* full-bleed editorial hero */}
      <Box
        sx={{
          bgcolor: "action.hover",
          borderBottom: 1,
          borderColor: "divider",
          py: { xs: 6, md: 10 },
          px: 3,
        }}
      >
        <Container maxWidth="md" sx={{ px: 0 }}>
          <Typography
            variant="overline"
            sx={{ color: ACCENT, letterSpacing: 2, fontWeight: 700 }}
          >
            an independent research index
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontSize: { xs: "2.25rem", md: "3.25rem" },
              fontWeight: 800,
              lineHeight: 1.05,
              mt: 1,
              letterSpacing: "-0.02em",
            }}
          >
            A searchable map of who, what, and where —
            <Box component="span" sx={{ color: ACCENT }}>
              {" "}across the entire Why Files corpus.
            </Box>
          </Typography>
          <Typography
            variant="h6"
            sx={{
              mt: 3,
              color: "text.secondary",
              fontWeight: 400,
              maxWidth: 720,
              lineHeight: 1.55,
            }}
          >
            Every episode of{" "}
            <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
              The Why Files
            </Link>{" "}
            turned into structured data. People, places, events, and
            the claims made about them — each one anchored to the exact
            transcript line it came from. Nothing floats. Nothing is
            declared true. You just get to see who said what, where
            they said it, and who disagreed.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 4 }}>
            <Button
              component={RouterLink}
              to="/videos"
              variant="contained"
              size="large"
              sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: ACCENT, filter: "brightness(0.9)" } }}
            >
              Browse the catalog
            </Button>
            <Button
              component="a"
              href="#intro"
              variant="outlined"
              size="large"
            >
              Read the intro first
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* intro body — long-form, no cards */}
      <Container id="intro" maxWidth="md" sx={{ mt: { xs: 5, md: 7 }, mb: 8 }}>
        <Lede>What you're actually looking at</Lede>
        <Typography paragraph sx={{ fontSize: "1.08rem", lineHeight: 1.7 }}>
          <em>The Why Files</em> covers contested territory: UFOs,
          cryptids, ancient mysteries, unsolved cases, fringe science.
          That's the kind of material where a normal "search the video"
          experience falls apart. You don't want a keyword hit — you
          want to know <strong>every time a given person, place, or
          event is mentioned</strong>, what was claimed about it, who
          contradicted whom, and which episode introduced which thread.
        </Typography>
        <Typography paragraph sx={{ fontSize: "1.08rem", lineHeight: 1.7 }}>
          So we ingest every transcript, run it through a neural
          entity + relation extractor, then an AI pass that pulls out{" "}
          <strong>thesis-level claims</strong> — the things the host
          is actually asserting, each with a one-sentence evidence
          quote. A second pass finds where claims disagree across
          episodes. A reasoning layer propagates truth through the
          dependency graph. The output is three things you can query:
          a catalog, a graph, and a claim browser — all of it pointing
          back to the line of transcript it came from.
        </Typography>

        <Lede sx={{ mt: 5 }}>The three ideas that matter</Lede>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }}>
          <Concept
            word="Claim"
            body="A thesis-level statement the host makes. Not every fact, just the ones you'd put in a Wikipedia section heading."
          />
          <Concept
            word="Evidence"
            body="Every claim points back to a specific transcript span. No floating assertions — you can jump to the line and hear it."
          />
          <Concept
            word="Contradiction"
            body="Where claims disagree — inside one episode, or across two episodes. The verifier checks each pair before we surface it."
          />
        </Stack>

        <Lede sx={{ mt: 5 }}>When you're ready, jump in</Lede>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, gap: 1 }}>
          <Chip to="/videos" label="The catalog" />
          <Chip to="/claims" label="All claims" />
          <Chip to="/contradictions" label="Contradictions" />
          <Chip to="/cross-video-agreements" label="Agreements" />
          <Chip to="/entity-graph" label="Entity graph" />
        </Stack>
      </Container>
    </Box>
  );
}

function Lede({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography
      component="h2"
      sx={{
        fontSize: "0.8rem",
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "text.secondary",
        borderTop: 2,
        borderColor: ACCENT,
        pt: 2,
        mb: 2,
        ...sx,
      }}
    >
      {children}
    </Typography>
  );
}

function Concept({ word, body }: { word: string; body: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, flex: 1, borderRadius: 2 }}>
      <Typography sx={{ fontWeight: 800, color: ACCENT, fontSize: "1.2rem", mb: 0.5 }}>
        {word}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {body}
      </Typography>
    </Paper>
  );
}

function Chip({ to, label }: { to: string; label: string }) {
  return (
    <Link
      component={RouterLink}
      to={to}
      sx={{
        display: "inline-block",
        px: 1.75, py: 0.75,
        border: 1, borderColor: "divider",
        borderRadius: 5,
        textDecoration: "none",
        fontSize: "0.9rem",
        fontWeight: 500,
        "&:hover": { borderColor: ACCENT, bgcolor: "action.hover" },
      }}
    >
      {label} →
    </Link>
  );
}
