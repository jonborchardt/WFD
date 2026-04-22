import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Box, Container, Link, Paper, Typography,
} from "@mui/material";
import { colors } from "../theme";

// Single subtle accent used across the page. Section colors tried
// earlier read as a rainbow; one restrained accent plus type hierarchy
// does the same job without the noise.
const ACCENT = colors.brand.accent;

export function HomePage() {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 6 }}>
      {/* ── hero ─────────────────────────────────────────────── */}
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
          home
        </Typography>
        <Typography
          variant="h4"
          sx={{ fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}
        >
          {/* "Why Files" is the channel name; keep those two words
              tight so the title doesn't read as "Why" + "Files
              Database." */}
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
          An independent, evidence-anchored index of <em>The Why Files</em>{" "}
          corpus — searchable, traceable, and built from the transcripts up.
        </Typography>
      </Paper>

      <StartHere />

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
          ingests the full YouTube
          transcript corpus of{" "}
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
          The corpus is, by design,{" "}
          <strong>contested and controversial</strong>: UFOs, cryptids,
          ancient mysteries, unsolved cases, fringe science. That's
          exactly the kind of material where a normal "search the video"
          experience falls apart. You don't want a keyword hit — you want
          to know every time a given person, place, or event is
          mentioned, what was claimed about it, who contradicted whom,
          and which episode introduced which thread.
        </Typography>
        <Callout>
          Our goal is <strong>not to declare truth</strong>. The goal is
          to make claims, evidence, and contradictions <em>traceable</em>.
          Every edge in the graph carries an evidence pointer: a
          transcript id plus a character span, so you can jump straight
          to the line and hear it in context. No floating claims, no
          vibes, no "trust us."
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
          statements the host makes, each with evidence quotes, a truth
          score, and (where relevant) <em>dependencies</em> on other
          claims — "this follows from," "this contradicts," "this
          presupposes." A reasoning layer then propagates truth through
          the claim graph, flags contradictions (within a single episode,
          between episodes, or when a presupposition is broken), and
          supports counterfactual queries: "if this claim were false,
          which others would move?"
        </Typography>
        <Typography paragraph sx={{ mb: 0 }}>
          Everything is searchable and filterable by truth, kind, and
          stance. Each claim row carries a truth bar and a confidence bar
          so you can see at a glance whether the AI thinks the host is
          asserting something firmly, steelmanning a fringe idea, or
          explicitly debunking it.
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
    </Container>
  );
}

// ── Start here showcase ──────────────────────────────────────────
// Four deep-linked examples that each showcase one capability.
// Inline-SVG miniatures rather than external images: zero asset
// deps, no network, they scale cleanly, and they visually echo
// what each destination looks like.
//
// The exact entity / claim ids in these URLs may need adjusting
// once the corpus is re-indexed (e.g. if the default seed claim
// gets renumbered). The claim id `-HxKHUEwnug:c_0003` matches the
// ClaimGraphPage default seed as of writing.
function StartHere() {
  const nav = useNavigate();
  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 3,
        p: { xs: 2.5, md: 3 },
        borderRadius: 2,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          mb: 0.25,
        }}
      >
        Start here
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          mb: 2, pb: 1, borderBottom: 1, borderColor: "divider",
        }}
      >
        Four one-click examples that show off what this site does.
      </Typography>
      <Box sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 1.5,
      }}>
        <ShowcaseCard
          title="Browse The Why Files catalog"
          body="The full faceted catalog — filter videos by person, place, organization, event, year, or any combination."
          href="/videos"
          onClick={() => nav("/videos")}
          image={<MiniVideos />}
        />
        <ShowcaseCard
          title="Most-contradicted claims"
          body="Jump to the claims browser sorted by contradiction count. Where the host disagrees most with himself (or with other episodes)."
          href="/claims?sort=contradicted"
          onClick={() => nav("/claims?sort=contradicted")}
          image={<MiniClaims />}
        />
        <ShowcaseCard
          title="Cross-video conflicts"
          body="Claims from different episodes that share entities and assert opposite things."
          href="/contradictions?kind=cross-video&sort=shared-desc"
          onClick={() =>
            nav("/contradictions?kind=cross-video&sort=shared-desc")
          }
          image={<MiniContradictions />}
        />
        <ShowcaseCard
          title="See an argument map"
          body="A claim-dependency graph — supports, contradictions, and shared-evidence links. In this example, seeded on the Marfa lights mystery."
          href="/argument-map?kind=claim&q=-HxKHUEwnug:c_0003"
          onClick={() =>
            nav("/argument-map?kind=claim&q=-HxKHUEwnug:c_0003")
          }
          image={<MiniArgumentMap />}
        />
      </Box>
    </Paper>
  );
}

interface ShowcaseCardProps {
  title: string;
  body: string;
  href: string;
  onClick: () => void;
  image: ReactNode;
}

function ShowcaseCard({ title, body, href, onClick, image }: ShowcaseCardProps) {
  return (
    // Anchor so middle-click / ⌘-click opens the deep link in a new
    // tab; onClick still drives SPA navigation for normal clicks.
    <Box
      component="a"
      href={href}
      onClick={(e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick();
      }}
      sx={{
        display: "flex", gap: 1.5,
        p: 1.5, border: 1, borderColor: "divider",
        borderRadius: 1,
        textDecoration: "none", color: "inherit",
        cursor: "pointer",
        transition: "background-color 120ms, border-color 120ms",
        "&:hover": {
          bgcolor: "action.hover", borderColor: ACCENT,
        },
      }}
    >
      <Box sx={{
        width: 96, height: 64, flexShrink: 0,
        borderRadius: 0.5, overflow: "hidden",
        bgcolor: "action.hover",
        border: 1, borderColor: "divider",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {image}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.25 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

// ── SVG miniatures ──────────────────────────────────────────────
// Each ~96×64, color-echoing the feature. Stylized rather than
// literal — enough to give the eye a hint of what the page shows
// without trying to render actual UI.
//
// These hex values are intentionally inline. They're a decorative
// pastel palette used nowhere else in the app — surfacing them
// through the central theme would only add noise, since they have
// no semantic role. (See the comment block at the top of theme.ts.)

function MiniVideos() {
  // Facet-rail sketch: one "search bar" up top, three bar-list rows
  // below with varying widths, evoking BarListFacet cards.
  return (
    <svg width="96" height="64" viewBox="0 0 96 64">
      <rect x="6" y="6" width="84" height="8" rx="2"
        fill="#e3f2fd" stroke="#90caf9" />
      <rect x="6" y="20" width="50" height="6" rx="1" fill="#90caf9" />
      <rect x="6" y="30" width="70" height="6" rx="1" fill="#64b5f6" />
      <rect x="6" y="40" width="34" height="6" rx="1" fill="#42a5f5" />
      <rect x="6" y="50" width="58" height="6" rx="1" fill="#1e88e5" />
    </svg>
  );
}

function MiniClaims() {
  // Claim-row sketch: a chip, a text line, two truth/confidence bars.
  return (
    <svg width="96" height="64" viewBox="0 0 96 64">
      <rect x="6" y="6" width="18" height="8" rx="2" fill="#1976d2" />
      <rect x="28" y="7" width="60" height="6" rx="1" fill="#cfd8dc" />
      <rect x="6" y="22" width="80" height="4" rx="1" fill="#eceff1" />
      <rect x="6" y="22" width="56" height="4" rx="1" fill="#66bb6a" />
      <rect x="6" y="32" width="80" height="4" rx="1" fill="#eceff1" />
      <rect x="6" y="32" width="40" height="4" rx="1" fill="#ff7043" />
      <rect x="6" y="46" width="22" height="6" rx="1" fill="#b0bec5" />
      <rect x="32" y="46" width="22" height="6" rx="1" fill="#b0bec5" />
    </svg>
  );
}

function MiniContradictions() {
  // Two panels with opposing arrows meeting in the middle.
  return (
    <svg width="96" height="64" viewBox="0 0 96 64">
      <rect x="6" y="10" width="34" height="44" rx="2"
        fill="#fff3e0" stroke="#ffb74d" />
      <rect x="56" y="10" width="34" height="44" rx="2"
        fill="#fbe9e7" stroke="#ff8a65" />
      <path d="M24 32 L44 32" stroke="#ef6c00"
        strokeWidth="2" fill="none" markerEnd="url(#cx-rm)" />
      <path d="M72 32 L52 32" stroke="#d84315"
        strokeWidth="2" fill="none" markerEnd="url(#cx-lm)" />
      <defs>
        <marker id="cx-rm" viewBox="0 0 10 10" refX="7" refY="5"
          markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef6c00" />
        </marker>
        <marker id="cx-lm" viewBox="0 0 10 10" refX="7" refY="5"
          markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d84315" />
        </marker>
      </defs>
      <circle cx="48" cy="32" r="4" fill="#f57c00" />
    </svg>
  );
}

function MiniArgumentMap() {
  // Five nodes in a small network, colored by stylized "truth".
  return (
    <svg width="96" height="64" viewBox="0 0 96 64">
      <line x1="22" y1="20" x2="48" y2="32"
        stroke="#90a4ae" strokeWidth="1.5" />
      <line x1="22" y1="20" x2="22" y2="48"
        stroke="#90a4ae" strokeWidth="1.5" />
      <line x1="48" y1="32" x2="74" y2="20"
        stroke="#90a4ae" strokeWidth="1.5" />
      <line x1="48" y1="32" x2="74" y2="48"
        stroke="#90a4ae" strokeWidth="1.5" />
      <line x1="22" y1="48" x2="48" y2="32"
        stroke="#ef5350" strokeWidth="1.5" strokeDasharray="3 2" />
      <circle cx="22" cy="20" r="6" fill="#66bb6a" />
      <circle cx="22" cy="48" r="6" fill="#ffb74d" />
      <circle cx="48" cy="32" r="7" fill="#42a5f5"
        stroke="#1565c0" strokeWidth="2" />
      <circle cx="74" cy="20" r="6" fill="#81c784" />
      <circle cx="74" cy="48" r="6" fill="#e57373" />
    </svg>
  );
}

// ── shared building blocks ───────────────────────────────────────
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
