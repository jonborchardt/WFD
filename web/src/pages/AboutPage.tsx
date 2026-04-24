import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Box, Container, Link, Paper, Typography } from "@mui/material";
import { colors } from "../theme";
import { UfoLogo } from "../components/brand";

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
        <Box sx={{
          display: "flex",
          alignItems: "center",
          gap: { xs: 2, sm: 3 },
          mt: 0.5,
          flexDirection: { xs: "column", sm: "row" },
          textAlign: { xs: "center", sm: "left" },
        }}>
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="h4"
              sx={{ fontWeight: 700, lineHeight: 1.2 }}
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
          </Box>
          <Box sx={{
            flexShrink: 0,
            "& > *": { animation: "wfd-about-hover 5s ease-in-out infinite" },
            "@keyframes wfd-about-hover": {
              "0%, 100%": { transform: "translateY(0)" },
              "50%":      { transform: "translateY(-8px)" },
            },
          }}>
            <UfoLogo height={120} />
          </Box>
        </Box>
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
          takes every YouTube transcript from{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>{" "}
          and turns it into something you can actually <em>search</em>:
          a catalog of episodes, a map of the people, places, groups,
          and events talked about across hundreds of episodes, and a
          set of tools for surfacing contradictions, repeat claims,
          and new connections — all of it pointing back to the exact
          moment in the exact video where something was said.
        </Typography>
      </Section>

      <Section title="Why build it?">
        <Typography paragraph>
          Topics like UFOs and ancient mysteries keep coming back
          across episodes, and the story changes as they do. A
          viewer who's watched every episode carries a mental map:
          which claims the host has stated firmly, which ones he's
          walked back, which ones he's debunked in a later episode,
          and which ones he's laid out fairly just to engage with
          them. That map only exists in your head. This site is an
          attempt to put it on the screen.
        </Typography>
        <Typography paragraph>
          Once the transcripts become a searchable database, a lot
          of questions that are painful to ask a YouTube search bar
          become easy: <em>"every time Bigfoot has been mentioned,
          sorted by how firmly the host was stating the claim"</em>,{" "}
          <em>"every place two episodes disagree about the same
          event"</em>, <em>"every claim whose support quietly leans
          on something the host himself rejected elsewhere"</em>.
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
          The site builds itself in stages. First we{" "}
          <strong>pull in</strong> transcripts directly from YouTube
          (politely — transcripts are gold; once we have one, we
          never re-fetch it). Then two AI models do the heavy
          lifting: the first one pulls out the names in each episode
          — people, groups, places, buildings, events, dates, roles,
          technologies, books and movies, laws, ideologies, and so
          on — and the second one figures out how they connect.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          After that, a more careful <strong>AI pass</strong> cleans
          up what those models missed or got wrong, and adds
          connections they couldn't see. A merge step ties together
          the same name when it shows up in different forms (e.g.
          "Dan" and "Dan Brown" across 40 videos) and drops known
          junk. Everything lands in one big map with a truth score
          on each claim, contradiction spotting, and loop detection.
          A separate "skeptic" layer rates each speaker's track
          record from what their own transcripts say. The public
          site you're reading right now is the read-only front end
          on top of all of that.
        </Typography>
      </Section>

      <Section title="Claims & contradictions">
        <Typography paragraph>
          On top of that map, another AI pass reads each transcript
          and pulls out the <strong>claims</strong>: the big points
          the host is making — the kind of thing worth a heading —
          each one with a short quote from the transcript, a truth
          score, and (when it applies) <em>links</em> to other
          claims: "this backs up," "this contradicts," "this takes
          for granted." Contradiction links are tagged so the site
          knows whether claim A <em>rules out</em> claim B,{" "}
          <em>pushes back on the evidence for</em> it, offers a{" "}
          <em>different explanation</em>, or just <em>weakens</em>{" "}
          it.
        </Typography>
        <Typography paragraph>
          A reasoning layer works truth out from the links (within a
          single episode, between episodes, or when one claim quietly
          assumes something another claim denies), and answers
          "what-if" questions: "if this claim turned out to be
          false, which other claims would move?" Contradictions
          across episodes are found by matching claims that sound
          like they might disagree, then double-checked by a second
          AI pass — so what shows up on{" "}
          <Link component={RouterLink} to="/contradictions">
            /contradictions
          </Link>{" "}
          is real disagreement, not two episodes that happen to
          mention the same name.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          The flip side also gets its own page:{" "}
          <Link component={RouterLink} to="/cross-video-agreements">
            /cross-video-agreements
          </Link>{" "}
          lists pairs the checker identified as the same idea said
          twice in two different episodes — agreement rather than
          conflict. Everything is searchable and can be filtered by
          truth, type, and the host's stance. Each claim row has a
          truth bar and a confidence bar so you can see at a glance
          whether the host is stating something firmly, giving a
          fringe idea a fair hearing, or flat-out knocking it down.
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
