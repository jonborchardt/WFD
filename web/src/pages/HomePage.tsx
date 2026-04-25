import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Button, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { colors } from "../theme";
import { UfoLogo } from "../components/brand";
import { TruthTimeline } from "./../components/TruthTimeline";
import type { PersistedClaims } from "../types";

// Hand-crafted illustrative claims for the home-page walk-through.
// Spread across a 28-minute "video" with a mix of confident-true,
// hedged, and confidently-false claims so the chart shows real shape.
// Click-to-scroll is a no-op here (the dots reference ids that don't
// exist on this page) — that's intentional; the chart is decorative.
const DEMO_CLAIMS: PersistedClaims = {
  schemaVersion: 1,
  transcriptId: "demo",
  generatedAt: "2026-04-24T00:00:00.000Z",
  generator: "homepage-illustration",
  claims: [
    { id: "demo:c1", videoId: "demo", text: "Marfa lights were first reported in the 1880s, well before automobiles.", kind: "historical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart:   95, timeEnd: 0, quote: "" }], confidence: 0.92, directTruth: 0.78, rationale: "", hostStance: "asserts" },
    { id: "demo:c2", videoId: "demo", text: "Some early sightings turned out to be hoaxes by local ranchers.",          kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart:  280, timeEnd: 0, quote: "" }], confidence: 0.74, directTruth: 0.55, rationale: "", hostStance: "asserts" },
    { id: "demo:c3", videoId: "demo", text: "The lights are caused by a localized magnetic anomaly.",                     kind: "speculative", entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart:  470, timeEnd: 0, quote: "" }], confidence: 0.85, directTruth: 0.18, rationale: "", hostStance: "denies" },
    { id: "demo:c4", videoId: "demo", text: "Atmospheric ducting can bend light from distant car headlights.",            kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart:  720, timeEnd: 0, quote: "" }], confidence: 0.95, directTruth: 0.82, rationale: "", hostStance: "asserts" },
    { id: "demo:c5", videoId: "demo", text: "Researchers replicated the lights using mounted headlights on Highway 67.",  kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart:  955, timeEnd: 0, quote: "" }], confidence: 0.88, directTruth: 0.74, rationale: "", hostStance: "asserts" },
    { id: "demo:c6", videoId: "demo", text: "Reports describe the lights moving in deliberate patterns.",                 kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart: 1180, timeEnd: 0, quote: "" }], confidence: 0.62, directTruth: 0.40, rationale: "", hostStance: "uncertain" },
    { id: "demo:c7", videoId: "demo", text: "The lights are visible from a single county-built viewing platform.",        kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart: 1380, timeEnd: 0, quote: "" }], confidence: 0.97, directTruth: 0.92, rationale: "", hostStance: "asserts" },
    { id: "demo:c8", videoId: "demo", text: "All Marfa-light photographs are deliberate fabrications.",                    kind: "empirical",   entities: [], relationships: [], evidence: [{ transcriptId: "demo", charStart: 0, charEnd: 0, timeStart: 1540, timeEnd: 0, quote: "" }], confidence: 0.80, directTruth: 0.10, rationale: "", hostStance: "denies" },
  ],
};
const DEMO_LENGTH_SECONDS = 28 * 60;

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
            an independent fan-built index
          </Typography>
          <Box sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 2, md: 3 },
            mt: 1,
            maxWidth: 720,
            flexDirection: { xs: "column", sm: "row" },
            textAlign: { xs: "center", sm: "left" },
          }}>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: "2rem", md: "2.75rem" },
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                flex: 1,
              }}
            >
              A searchable map of who, what, and where —
              <Box component="span" sx={{ color: ACCENT }}>
                {" "}across every Why Files episode.
              </Box>
            </Typography>
            <Box sx={{
              flexShrink: 0,
              "& > *": { animation: "wfd-home-hover 6s ease-in-out infinite" },
              "@keyframes wfd-home-hover": {
                "0%, 100%": { transform: "translateY(0)" },
                "50%":      { transform: "translateY(-6px)" },
              },
            }}>
              <UfoLogo height={110} />
            </Box>
          </Box>
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
            turned into a database you can actually search. People,
            places, events, and the claims made about them — each
            one tied to the exact line in the transcript it came
            from. Nothing is floating. Nothing is declared true. You
            just see who said what, where they said it, and who
            disagreed.
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
            cryptids, ancient mysteries, unsolved cases, weird
            science. With that kind of material, searching a single
            video for a keyword isn't enough. You want to know{" "}
            <em>every</em> time a person, place, or event comes up,
            what was said about it, who pushed back, and which
            episode started the thread.
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

        {/* Step 1 — the story arc */}
        <Step index={1} label="The story arc">
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderLeft: 4, borderColor: ACCENT }}>
            <Typography variant="caption" color="text.secondary">
              from "Marfa Lights: Texas's UFO mystery"
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <TruthTimeline
                claims={DEMO_CLAIMS}
                lengthSeconds={DEMO_LENGTH_SECONDS}
                showHeading={false}
                interactive={false}
              />
            </Box>
          </Paper>
          <Caption>
            Every episode gets a <strong>story arc</strong> — a quick
            visual of every claim the host made, plotted across the
            runtime. Green sits above the line (likely true), red sits
            below (likely false), and the dashed lines show how
            confident we are.
          </Caption>
        </Step>

        {/* Step 2 — the claim itself */}
        <Step index={2} label="The claim">
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
            A <strong>claim</strong> is a single point the host is
            making — not every small fact, just the ones big enough
            to get their own heading. Each one gets a truth score
            and a note on whether the host is stating it, pushing
            back on it, or bringing it up to knock it down.
          </Caption>
        </Step>

        {/* Step 3 — the evidence */}
        <Step index={3} label="The evidence">
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
            Every claim points back to the{" "}
            <strong>exact words in the transcript</strong> — a
            specific episode and timestamp you can click through to.
            No floating claims, no "trust us" — if the claim isn't
            anchored, it doesn't exist.
          </Caption>
        </Step>

        {/* Step 4 — the cross-video contradiction */}
        <Step index={4} label="The contradiction">
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
              ACROSS EPISODES · CAN'T BOTH BE TRUE
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
            A second pass hunts for claims in different episodes
            that don't fit together, checks each one, and surfaces
            only the real disagreements. This is a{" "}
            <strong>cross-episode contradiction</strong> — same
            host, two different episodes, two things that can't
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
            Multiply that by every episode and every claim, and you
            get a big web of connections. The rest of the site is
            just different ways to look at it.
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
