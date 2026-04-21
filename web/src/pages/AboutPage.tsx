import { useNavigate } from "react-router-dom";
import { Container, Paper, Typography, Link } from "@mui/material";

export function AboutPage() {
  const nav = useNavigate();
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 6 }}>
      <Paper sx={{ p: { xs: 3, md: 5 } }}>
        <Typography variant="h3" gutterBottom>About this project</Typography>
        <Typography variant="subtitle1" color="text.secondary" gutterBottom>
          An independent, evidence-anchored index of <em>The Why Files</em> corpus.
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>What is this?</Typography>
        <Typography paragraph>
          <strong>Why Files Database</strong> ingests the full YouTube transcript corpus of{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">The Why Files</Link>{" "}
          and turns it into something you can actually <em>query</em>: a searchable catalog
          of videos, an extracted graph of the people, places, organizations, and
          events discussed across hundreds of episodes, and a set of tools for
          surfacing contradictions, recurring claims, and novel connections — all of
          it pointing back to the exact moment in the exact video where something
          was said.
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>Why build it?</Typography>
        <Typography paragraph>
          The corpus is, by design, <strong>contested and controversial</strong>: UFOs,
          cryptids, ancient mysteries, unsolved cases, fringe science. That's
          exactly the kind of material where a normal "search the video" experience
          falls apart. You don't want a keyword hit — you want to know every time a
          given person, place, or event is mentioned, what was claimed about it,
          who contradicted whom, and which episode introduced which thread.
        </Typography>
        <Typography paragraph>
          Our goal is <strong>not to declare truth</strong>. The goal is to make claims,
          evidence, and contradictions <em>traceable</em>. Every edge in the graph
          carries an evidence pointer: a transcript id plus a character span, so
          you can jump straight to the line and hear it in context. No floating
          claims, no vibes, no "trust us."
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>How it works</Typography>
        <Typography paragraph>
          The pipeline runs in stages. First we <strong>fetch</strong> transcripts
          directly from YouTube (politely — transcripts are gold; once we have
          one, we never re-fetch it). Then a pair of zero-shot neural models
          does the heavy lifting: <strong>GLiNER</strong> pulls out entities
          across fourteen label types (people, organizations, locations,
          facilities, events, dates, roles, technologies, works of media, laws,
          ideologies, and more) and <strong>GLiREL</strong> scores relations
          between them against a vocabulary of predicates.
        </Typography>
        <Typography paragraph>
          After that, an <strong>AI enrichment</strong> pass refines and adds
          relationships the neural models missed. A cross-transcript alias
          layer merges duplicates (e.g. "Dan" and "Dan Brown" across 40
          videos) and filters known noise. Everything lands in a graph store
          with per-claim truth scoring, contradiction detection, and loop
          detection. A separate "skeptic" layer scores speaker credibility
          from transcript signals. The public site you're reading right now
          is the read-only front end on top of all of that.
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>Claims &amp; contradictions</Typography>
        <Typography paragraph>
          On top of the relationship graph, an AI pass over each transcript
          extracts <strong>claims</strong>: thesis-level statements the host
          makes, each with evidence quotes, a truth score, and (where
          relevant) <em>dependencies</em> on other claims — "this follows
          from," "this contradicts," "this presupposes." A reasoning layer
          then propagates truth through the claim graph, flags
          contradictions (within a single episode, between episodes, or when
          a presupposition is broken), and supports counterfactual queries:
          "if this claim were false, which others would move?"
        </Typography>
        <Typography paragraph>
          Everything is searchable by <strong>tag</strong> and filterable
          by truth, kind, and stance. Each claim row carries a truth bar
          and a confidence bar so you can see at a glance whether the
          AI thinks the host is asserting something firmly, steelmanning
          a fringe idea, or explicitly debunking it.
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>What you can do here</Typography>
        <Typography component="div" paragraph>
          <ul>
            <li>Browse the full catalog of ingested videos on the <Link component="button" onClick={() => nav("/")}>home page</Link>.</li>
            <li>Explore the extracted <Link component="button" onClick={() => nav("/relationships")}>relationships graph</Link> across the entire corpus, optionally colored by derived truth.</li>
            <li>Read thesis-level <Link component="button" onClick={() => nav("/claims")}>claims</Link> with truth + evidence, sorted by certainty or by contradiction count.</li>
            <li>Inspect flagged <Link component="button" onClick={() => nav("/contradictions")}>contradictions</Link> — within-video, cross-video, or broken presuppositions.</li>
            <li>Visualize <Link component="button" onClick={() => nav("/claim-graph")}>claim graph</Link> — seed by an entity, video, or claim and see dependencies, contradictions, and shared-evidence links.</li>
            <li>Slice the corpus by entity type, episode, or theme in <Link component="button" onClick={() => nav("/facets")}>facets</Link>.</li>
            <li>Click any entity to see every video it appears in, with jump-to-timestamp links.</li>
            <li><strong>Spotted something wrong?</strong> Every entity, relationship, claim, and contradiction has a pencil (<code>✎</code>) edit button that opens a prefilled GitHub issue so we can fix it. You can suggest truth changes, better wording, new tags, or flag a contradiction the detector missed.</li>
          </ul>
        </Typography>

        <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>Credit</Typography>
        <Typography paragraph>
          All transcript content belongs to{" "}
          <Link href="https://thewhyfiles.com" target="_blank" rel="noopener">The Why Files</Link> and AJ Gentile. This is an
          independent research index and is not affiliated with, endorsed by, or
          operated by The Why Files. If you enjoy the show, please support it
          directly on{" "}
          <Link href="https://www.patreon.com/thewhyfiles" target="_blank" rel="noopener">Patreon</Link>, the{" "}
          <Link href="https://shop.thewhyfiles.com" target="_blank" rel="noopener">Shop</Link>, or{" "}
          <Link href="https://www.youtube.com/@TheWhyFiles" target="_blank" rel="noopener">YouTube</Link>.
        </Typography>
      </Paper>
    </Container>
  );
}
