import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Button, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { colors } from "../theme";

// Editorial hero establishes what the site is and why it exists,
// then a three-step walk-through teaches the core concepts (claim,
// evidence, contradiction) on one illustrative example. Long-form
// explanation of the pipeline, data model, and credit lives on /about.

const ACCENT = colors.brand.accent;

export function HomePage() {
  return (
    <Box>
      {/* ── hero ──────────────────────────────────────────────── */}
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
            the claims made about them — each one anchored to the
            exact transcript line it came from. Nothing floats.
            Nothing is declared true. You just get to see who said
            what, where they said it, and who disagreed.
          </Typography>
          <Typography
            variant="body1"
            sx={{
              mt: 2.5,
              color: "text.secondary",
              maxWidth: 720,
              lineHeight: 1.65,
            }}
          >
            <em>The Why Files</em> covers contested territory: UFOs,
            cryptids, ancient mysteries, unsolved cases, fringe
            science. That's the kind of material where a normal
            "search the video" experience falls apart. You don't
            want a keyword hit — you want to know every time a given
            person, place, or event is mentioned, what was claimed
            about it, who contradicted whom, and which episode
            introduced which thread.
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
              href="#walkthrough"
              variant="outlined"
              size="large"
            >
              See how it works
            </Button>
            <Button
              component={RouterLink}
              to="/about"
              variant="text"
              size="large"
            >
              About this project
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* ── walk-through ──────────────────────────────────────── */}
      <Container id="walkthrough" maxWidth="md" sx={{ mt: { xs: 5, md: 7 }, mb: 8 }}>
        <Typography
          variant="overline"
          sx={{
            color: "text.secondary",
            letterSpacing: 2,
            fontWeight: 700,
            borderTop: 2,
            borderColor: ACCENT,
            pt: 2,
            display: "block",
            mb: 2,
          }}
        >
          how it works · in one claim
        </Typography>
        <Typography
          component="h2"
          sx={{
            fontSize: { xs: "1.75rem", md: "2.25rem" },
            fontWeight: 700,
            lineHeight: 1.2,
            mb: 2,
          }}
        >
          Let's walk through <Box component="span" sx={{ color: ACCENT }}>one claim</Box> end-to-end.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 5, maxWidth: 620 }}>
          Once you've seen how one claim works, the rest of the site
          is just more of these. Here's an illustrative example,
          annotated.
        </Typography>

        {/* Step 1 — the claim itself */}
        <Step index={1} label="The claim">
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderLeft: 4, borderColor: ACCENT }}>
            <Typography variant="caption" color="text.secondary">
              from "Marfa Lights: Texas's UFO mystery"
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: "1.1rem", lineHeight: 1.5 }}>
              "The Marfa lights are most likely atmospheric reflections
              of distant car headlights on Highway 67."
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1.5, alignItems: "center" }}>
              <TruthBar value={0.62} />
              <Typography variant="caption" color="text.secondary">
                truth 0.62 · host stance: asserts
              </Typography>
            </Box>
          </Paper>
          <Caption>
            A <strong>claim</strong> is a single testable proposition
            the host makes — not every fact, just the ones worth a
            heading. Each one gets a <em>directTruth</em> score and a
            record of whether the host is asserting it, denying it,
            or presenting it to debunk it.
          </Caption>
        </Step>

        {/* Step 2 — the evidence */}
        <Step index={2} label="The evidence">
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, bgcolor: "action.hover" }}>
            <Typography variant="caption" color="text.secondary">
              transcript · 08:24
            </Typography>
            <Typography
              sx={{
                mt: 0.5,
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: "1.02rem",
                lineHeight: 1.6,
                borderLeft: 3,
                borderColor: "divider",
                pl: 2,
              }}
            >
              "…the prevailing scientific explanation is that what
              people are seeing from the viewing platform is actually
              reflected headlights from cars on Highway 67, bent by
              temperature gradients in the desert air."
            </Typography>
          </Paper>
          <Caption>
            Every claim points back to an <strong>evidence span</strong>:
            a specific transcript id + character range. You can click
            through to hear it in context. No floating assertions, no
            "trust us" — if the claim isn't anchored, it doesn't exist.
          </Caption>
        </Step>

        {/* Step 3 — the cross-video contradiction */}
        <Step index={3} label="The contradiction">
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: 2,
              borderLeft: 4,
              borderColor: "error.main",
            }}
          >
            <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
              CROSS-VIDEO · LOGICAL-CONTRADICTION
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: "1rem", lineHeight: 1.5 }}>
              "The Marfa lights can't be car headlights — local
              reports predate the Presidio highway by at least sixty
              years."
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              from "Top 10 unexplained American phenomena"
            </Typography>
          </Paper>
          <Caption>
            A second AI pass looks for claims across different
            episodes that assert <em>incompatible</em> theses,
            verdicts each candidate, and surfaces only the real
            disagreements. This is a{" "}
            <strong>cross-video contradiction</strong> — the same
            host, two different episodes, two claims that can't
            both be right.
          </Caption>
        </Step>

        <Box
          sx={{
            mt: 6, p: 4,
            border: 1, borderColor: "divider",
            borderRadius: 2,
            textAlign: "center",
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            That's the whole game.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 540, mx: "auto" }}>
            Multiply it by every episode, every claim, and the graph
            of everything that connects them. The rest of the site
            is just ways to slice that data.
          </Typography>
          <Box sx={{ display: "inline-flex", gap: 1.5, flexWrap: "wrap", justifyContent: "center" }}>
            <Button component={RouterLink} to="/claims" variant="contained">
              Browse all claims
            </Button>
            <Button component={RouterLink} to="/contradictions" variant="outlined">
              See every contradiction
            </Button>
            <Button component={RouterLink} to="/videos" variant="outlined">
              Start from a video
            </Button>
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}
          >
            Want the pipeline details, the data model, or how to
            flag a bad claim?{" "}
            <Link component={RouterLink} to="/about">
              Read the about page
            </Link>
            .
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}

function Step({ index, label, children }: { index: number; label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 2.5, mb: 4 }}>
      <Box sx={{ flexShrink: 0, width: 44, textAlign: "center" }}>
        <Box
          sx={{
            width: 40, height: 40,
            borderRadius: "50%",
            bgcolor: ACCENT,
            color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: "1.1rem",
          }}
        >
          {index}
        </Box>
        <Box
          sx={{
            width: 2, flex: 1, bgcolor: "divider",
            mx: "auto", mt: 1,
            minHeight: 40,
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", letterSpacing: 1.5, fontWeight: 700 }}
        >
          step {index} · {label}
        </Typography>
        <Box sx={{ mt: 1 }}>{children}</Box>
      </Box>
    </Box>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{
        mt: 1.5,
        pl: 2,
        borderLeft: 2,
        borderColor: ACCENT,
        lineHeight: 1.6,
      }}
    >
      {children}
    </Typography>
  );
}

function TruthBar({ value }: { value: number }) {
  return (
    <Box sx={{ flex: 1, maxWidth: 140, height: 6, bgcolor: "divider", borderRadius: 3, overflow: "hidden" }}>
      <Box
        sx={{
          width: `${Math.round(value * 100)}%`,
          height: "100%",
          bgcolor: value > 0.5 ? "success.main" : "warning.main",
        }}
      />
    </Box>
  );
}
