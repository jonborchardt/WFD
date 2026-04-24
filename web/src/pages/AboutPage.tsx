import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Container, Link, Paper, Typography } from "@mui/material";
import { colors } from "../theme";

// About page. Holds the long-form explanation — motivation,
// pipeline internals, claims+contradictions depth, contribution,
// and credit. The home page stays tight (hero + one-claim
// walk-through) and links here for everything else.

const ACCENT = colors.brand.accent;

export function AboutPage() {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 6 }}>
      <Paper
        variant="outlined"
        sx={{
          mb: 3,
          p: { xs: 3, md: 4 },
          borderLeft: 4,
          borderLeftColor: ACCENT,
          borderRadius: 2,
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: ACCENT, letterSpacing: 1, fontWeight: 600 }}
        >
          about
        </Typography>
        <Typography
          variant="h4"
          sx={{ fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}
        >
          About{" "}
          <Box
            component="span"
            sx={{ whiteSpace: "nowrap", wordSpacing: "-0.2em" }}
          >
            Why{"\u00a0"}Files
          </Box>{" "}
          Database
        </Typography>
        <Typography
          variant="subtitle1"
          sx={{ mt: 1, color: "text.secondary", maxWidth: 640 }}
        >
          What it is, why it exists, how the pipeline works, and how
          to help improve it. If you haven't seen the one-claim
          walk-through yet, start on the{" "}
          <Link component={RouterLink} to="/">home page</Link>.
        </Typography>
      </Paper>

      <Section title="What is this?">
        <Typography paragraph sx={{ mb: 0 }}>
          <strong>
            <Box
              component="span"
              sx={{ whiteSpace: "nowrap", wordSpacing: "-0.2em" }}
            >
              Why{"\u00a0"}Files
            </Box>{" "}
            Database
          </strong>{" "}
          ingests the full YouTube transcript corpus of{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>{" "}
          and turns it into something you can actually <em>query</em>: a
          searchable catalog of videos, an extracted graph of the people,
          places, organizations, and events discussed across hundreds of
          episodes, and a set of tools for surfacing contradictions,
          recurring claims, and novel connections — all of it pointing
          back to the exact moment in the exact video where something was
          said.
        </Typography>
      </Section>

      <Section title="Why build it?">
        <Typography paragraph>
          Contested, long-running topics accumulate a{" "}
          <em>narrative history</em> that no single episode captures.
          A viewer who has seen the entire corpus carries a model of
          which claims the host has asserted firmly, which he's
          walked back, which he's debunked in a later episode, and
          which he's introduced as a steelman. That model lives
          nowhere except in their head. This site is an attempt to
          externalize it.
        </Typography>
        <Typography paragraph>
          Once the transcripts are structured data, a lot of
          questions that are infeasible to ask a YouTube search bar
          become trivial: <em>"every time Bigfoot has been
          mentioned, sorted by how firmly the host was asserting the
          claim"</em>,{" "}
          <em>"all the places where two episodes disagree about the
          same event"</em>, <em>"every claim whose support depends on
          a presupposition the host himself rejected elsewhere"</em>.
        </Typography>
        <Callout>
          Our goal is <strong>not to declare truth</strong>. The goal
          is to make claims, evidence, and contradictions{" "}
          <em>traceable</em>. Every edge in the graph carries an
          evidence pointer: a transcript id plus a character span,
          so you can jump straight to the line and hear it in
          context. No floating claims, no vibes, no "trust us."
        </Callout>
      </Section>

      <Section title="How it works">
        <Typography paragraph>
          The pipeline runs in stages. First we <strong>fetch</strong>{" "}
          transcripts directly from YouTube (politely — transcripts are
          gold; once we have one, we never re-fetch it). Then a pair of
          zero-shot neural models does the heavy lifting:{" "}
          <Mono>GLiNER</Mono> pulls out entities across fourteen label
          types (people, organizations, locations, facilities, events,
          dates, roles, technologies, works of media, laws, ideologies,
          and more) and <Mono>GLiREL</Mono> scores relations between them
          against a vocabulary of predicates.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          After that, an <strong>AI enrichment</strong> pass refines and
          adds relationships the neural models missed. A cross-transcript
          alias layer merges duplicates (e.g. "Dan" and "Dan Brown"
          across 40 videos) and filters known noise. Everything lands in
          a graph store with per-claim truth scoring, contradiction
          detection, and loop detection. A separate "skeptic" layer
          scores speaker credibility from transcript signals. The public
          site you're reading right now is the read-only front end on top
          of all of that.
        </Typography>
      </Section>

      <Section title="Claims & contradictions">
        <Typography paragraph>
          On top of the relationship graph, an AI pass over each
          transcript extracts <strong>claims</strong>: thesis-level
          statements the host makes, each with a tight single-sentence
          evidence quote, a truth score, and (where relevant){" "}
          <em>dependencies</em> on other claims — "this follows from,"
          "this contradicts," "this presupposes." Contradicts
          dependencies carry a subkind tag so the reasoning layer knows
          whether A strictly rules out B, debunks it, proposes a
          competing explanation, or just undercuts its probative value.
        </Typography>
        <Typography paragraph>
          A reasoning layer propagates truth through the claim graph,
          flags contradictions (within a single episode, between
          episodes, or when a presupposition is broken), and supports
          counterfactual queries: "if this claim were false, which
          others would move?" Cross-video contradiction candidates are
          found by sentence-embedding similarity and then run through a
          second AI pass that verdicts each pair — so what surfaces on{" "}
          <Link component={RouterLink} to="/contradictions">
            /contradictions
          </Link>{" "}
          is real disagreement, not noise from a shared generic entity.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          The flip side also gets its own page:{" "}
          <Link component={RouterLink} to="/cross-video-agreements">
            /cross-video-agreements
          </Link>{" "}
          lists pairs the verifier identified as asserting the same
          thesis across two different videos — positive corroboration
          rather than conflict. Everything is searchable and filterable
          by truth, kind, and stance. Each claim row carries a truth
          bar and a confidence bar so you can see at a glance whether
          the AI thinks the host is asserting something firmly,
          steelmanning a fringe idea, or explicitly debunking it.
        </Typography>
      </Section>

      <Section title="Help improve it">
        <Typography paragraph sx={{ mb: 0 }}>
          <strong>Spotted something wrong?</strong> Every entity,
          relationship, claim, and contradiction has a pencil (
          <Mono>✎</Mono>) edit button that opens a prefilled GitHub issue
          so we can fix it. You can suggest truth changes, better
          wording, new tags, or flag a contradiction the detector missed.
        </Typography>
      </Section>

      <Section title="Credit">
        <Typography paragraph sx={{ mb: 0 }}>
          All transcript content belongs to{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>{" "}
          and AJ Gentile. This is an independent research index and is
          not affiliated with, endorsed by, or operated by The Why Files.
          If you enjoy the show, please support it directly on{" "}
          <Link
            href="https://www.patreon.com/thewhyfiles"
            target="_blank"
            rel="noopener"
          >
            Patreon
          </Link>
          , the{" "}
          <Link
            href="https://shop.thewhyfiles.com"
            target="_blank"
            rel="noopener"
          >
            Shop
          </Link>
          , or{" "}
          <Link
            href="https://www.youtube.com/@TheWhyFiles"
            target="_blank"
            rel="noopener"
          >
            YouTube
          </Link>
          .
        </Typography>
      </Section>

      <Box sx={{ mt: 3, textAlign: "center" }}>
        <Link component={RouterLink} to="/" sx={{ fontWeight: 500 }}>
          ← back to the walk-through
        </Link>
      </Box>
    </Container>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 2,
        p: { xs: 2.5, md: 3 },
        borderRadius: 2,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          mb: 1.5,
          pb: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        borderLeft: 3,
        borderColor: ACCENT,
        bgcolor: "action.hover",
        borderRadius: 1,
      }}
    >
      <Typography variant="body2" component="div">{children}</Typography>
    </Box>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: "monospace",
        fontSize: "0.9em",
        px: 0.5,
        py: 0.125,
        borderRadius: 0.5,
        bgcolor: "action.hover",
      }}
    >
      {children}
    </Box>
  );
}
