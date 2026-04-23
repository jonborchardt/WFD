import { Link as RouterLink } from "react-router-dom";
import { Box, Container, Link, Paper, Typography } from "@mui/material";
import { colors } from "../theme";

// Picker page so reviewers can click through the 5 candidate
// homepages side by side and pick the one that best solves the
// "feels like jumping into a dashboard" feedback. Delete this
// file (and the /home1…/home5 routes in App.tsx) once the choice
// lands in HomePage.tsx.

const ACCENT = colors.brand.accent;

interface Variant {
  path: string;
  name: string;
  angle: string;
  body: string;
}

const VARIANTS: Variant[] = [
  {
    path: "/",
    name: "Current homepage",
    angle: "baseline",
    body: "Thin hero → 6-card dashboard → explanation below. This is what the feedback was about.",
  },
  {
    path: "/home1",
    name: "1 · Narrative-first",
    angle: "big editorial hero, long-form intro, cards trimmed to chips at the bottom",
    body: "Reads like a magazine intro. Two CTAs in the hero, full prose explanation of WHAT and WHY before any shortcut appears. Card grid is replaced by a row of pill links.",
  },
  {
    path: "/home2",
    name: "2 · Walk-through example",
    angle: "teach by showing one concrete claim end-to-end",
    body: "Three numbered steps each annotated: 'this is a claim', 'this is the evidence anchor', 'this is a cross-video contradiction'. You leave knowing what the site is from a worked example, not a description.",
  },
  {
    path: "/home3",
    name: "3 · Numbers & concepts",
    angle: "newsroom-style stat tiles + triptych",
    body: "Big counts (videos / claims / contradictions / agreements), each tile defines the concept under the number. Then a 3-up 'what you can do here' — find / trace / surface. Shortcut row is quiet text links.",
  },
  {
    path: "/home4",
    name: "4 · FAQ",
    angle: "conversational Q&A accordion",
    body: "Answers the questions a first-time visitor walks up with, expandable. First two open by default so the page reads as prose; the rest collapse so it doesn't feel like a wall.",
  },
  {
    path: "/home5",
    name: "5 · Guided tour",
    angle: "four numbered steps with illustrations",
    body: "Pick a topic → see what was claimed → read the evidence → compare episodes. Each step has a mini illustration and a 'try step N' deep link. Tutorial framing, zero card grid.",
  },
];

export function HomeVariantsPage() {
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 6 }}>
      <Typography
        variant="overline"
        sx={{ color: ACCENT, letterSpacing: 2, fontWeight: 700 }}
      >
        internal · homepage bake-off
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1, mt: 0.5 }}>
        Pick the homepage
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 660 }}>
        Five drafts that each take a different angle on the feedback:
        <em> "feels like jumping right into a dashboard."</em> Click
        through, compare, and we'll promote the winner into{" "}
        <Box component="code" sx={{ fontFamily: "monospace" }}>HomePage.tsx</Box>.
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {VARIANTS.map((v) => (
          <Paper
            key={v.path}
            component={RouterLink}
            to={v.path}
            variant="outlined"
            sx={{
              display: "block",
              p: 2.5,
              borderRadius: 2,
              textDecoration: "none",
              color: "inherit",
              transition: "border-color 120ms, background-color 120ms",
              "&:hover": { borderColor: ACCENT, bgcolor: "action.hover" },
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2, flexWrap: "wrap" }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {v.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                {v.path}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{ display: "block", color: ACCENT, fontWeight: 600, letterSpacing: 0.5, mb: 0.75 }}
            >
              {v.angle}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
              {v.body}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 4, fontStyle: "italic" }}
      >
        Once the choice is made: copy the winning variant into{" "}
        <Link component={RouterLink} to="/">HomePage.tsx</Link>, delete
        the other HomePageN.tsx files, and remove the /home1…/home5
        and /home-variants routes from App.tsx.
      </Typography>
    </Container>
  );
}
