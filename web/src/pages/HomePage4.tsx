import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Button, Container, Link, Paper, Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { colors } from "../theme";

// Variant 4 — FAQ / conversational.
//
// The landing answers the questions a first-time visitor actually
// has, one at a time, in accordion form. The first two are expanded
// by default so the page reads as prose; the rest are collapsible so
// the page doesn't overwhelm. No card grid, no miniature illustrations
// — just the questions someone new is walking up with.

const ACCENT = colors.brand.accent;

export function HomePage4() {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 3, md: 5 },
          mb: 3,
          borderRadius: 2,
          bgcolor: "action.hover",
          textAlign: "center",
          borderLeft: 4,
          borderLeftColor: ACCENT,
        }}
      >
        <Typography
          variant="overline"
          sx={{ color: ACCENT, letterSpacing: 2, fontWeight: 700 }}
        >
          the why files database
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: "1.9rem", md: "2.5rem" },
            fontWeight: 700,
            mt: 1,
            lineHeight: 1.2,
          }}
        >
          A database of every claim,<br />
          made across every episode.
        </Typography>
        <Typography
          variant="subtitle1"
          color="text.secondary"
          sx={{ mt: 2, maxWidth: 620, mx: "auto" }}
        >
          New here? Start with the questions below. They answer what
          you're probably wondering before you click anything.
        </Typography>
      </Paper>

      <QA q="What am I actually looking at?" defaultExpanded>
        <Typography paragraph>
          An independent, evidence-anchored index of{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>{" "}
          — a YouTube channel about UFOs, cryptids, ancient mysteries,
          unsolved cases, and fringe science. The site takes every
          episode's transcript, extracts the people, places, events,
          and <em>claims</em> made in it, and makes the whole thing
          searchable.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          Think of it as a map of the corpus. You can start from a
          person (every episode mentioning them), a claim ("what has
          the host said about Bigfoot?"), or a contradiction (where
          two episodes disagree).
        </Typography>
      </QA>

      <QA q="Why would I want this?" defaultExpanded>
        <Typography paragraph>
          Because "search the video" is a terrible tool for contested
          content. You don't want a keyword hit — you want to know{" "}
          <strong>every time a given claim has come up</strong>, what
          evidence was cited, who pushed back, and which episode
          introduced which thread.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          So every claim on this site is tied to a specific transcript
          span. Every relationship in the graph is too. Nothing floats.
          If you want to know whether the host actually said something,
          the evidence is one click away.
        </Typography>
      </QA>

      <QA q="Do you think the claims are true?">
        <Typography paragraph>
          <strong>No — and more importantly, that's not the job.</strong>{" "}
          The goal is to make claims, evidence, and contradictions
          traceable, not to declare truth. A claim's <em>directTruth</em>{" "}
          score reflects how the host presented it (asserted, denied,
          debunked, steelmanned) and how well-supported it is relative
          to other claims in the corpus — it's a reading of the
          transcript, not a pronouncement about reality.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          A reasoning layer propagates truth through the claim graph,
          but it's always showing you why: which claims support which,
          which contradict, and which presuppose others. You can
          always click through to the underlying evidence and decide
          for yourself.
        </Typography>
      </QA>

      <QA q="Where do I start?">
        <Typography paragraph>
          Depends on how you think. If you're topic-driven, start
          from the catalog and filter by an entity that interests
          you. If you're curious what the host has asserted most
          strongly (or most often contradicted himself on), start
          with the claim browser. If you want to see where the corpus
          disagrees with itself, start with the contradictions page.
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
          <Button component={RouterLink} to="/videos" variant="outlined" size="small">
            Catalog
          </Button>
          <Button component={RouterLink} to="/claims" variant="outlined" size="small">
            Claims
          </Button>
          <Button component={RouterLink} to="/contradictions" variant="outlined" size="small">
            Contradictions
          </Button>
          <Button component={RouterLink} to="/cross-video-agreements" variant="outlined" size="small">
            Agreements
          </Button>
          <Button component={RouterLink} to="/entity-graph" variant="outlined" size="small">
            Entity graph
          </Button>
        </Box>
      </QA>

      <QA q="How does the extraction actually work?">
        <Typography paragraph>
          Transcripts get fetched from YouTube and stored locally (we
          never re-fetch a transcript we already have). A zero-shot
          neural extractor pulls out entities across 14 label types
          (person, organization, location, event, date, etc.) and a
          second model scores relations between them. An AI pass then
          extracts thesis-level claims with evidence anchors.
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          Cross-video contradiction candidates are found by
          sentence-embedding similarity and verdicted by a second AI
          pass — so what you see on /contradictions is real
          disagreement, not noise from a generic shared entity.
        </Typography>
      </QA>

      <QA q="I spotted something wrong.">
        <Typography paragraph sx={{ mb: 0 }}>
          Every entity, relationship, claim, and contradiction on the
          site has a pencil (<Box component="code" sx={{ fontFamily: "monospace" }}>✎</Box>)
          button that opens a prefilled GitHub issue. You can propose
          a truth change, better wording, new tags, or flag a
          contradiction the detector missed. The site is the read-only
          frontend — edits land in the queue and get applied during
          the next indexes rebuild.
        </Typography>
      </QA>

      <QA q="Is this affiliated with The Why Files?">
        <Typography paragraph sx={{ mb: 0 }}>
          No. This is an independent research index. All transcript
          content belongs to{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">
            The Why Files
          </Link>{" "}
          and AJ Gentile. If you enjoy the show, support it on{" "}
          <Link href="https://www.patreon.com/thewhyfiles" target="_blank" rel="noopener">
            Patreon
          </Link>
          ,{" "}
          <Link href="https://shop.thewhyfiles.com" target="_blank" rel="noopener">
            the shop
          </Link>
          , or{" "}
          <Link href="https://www.youtube.com/@TheWhyFiles" target="_blank" rel="noopener">
            YouTube
          </Link>
          .
        </Typography>
      </QA>
    </Container>
  );
}

function QA({
  q, children, defaultExpanded,
}: {
  q: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      sx={{
        mb: 1,
        borderRadius: 2,
        "&:before": { display: "none" },
        border: 1,
        borderColor: "divider",
      }}
      elevation={0}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          "& .MuiAccordionSummary-content": { my: 1.5 },
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: "1.15rem" }}>
          {q}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, pb: 2.5, fontSize: "1rem", lineHeight: 1.65 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}
