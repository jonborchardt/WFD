import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Typography, Box, Paper, Button, Link, Chip } from "@mui/material";
import { useOpenVideo } from "../components/VideoLightbox";
import { NlpPanel } from "../components/NlpPanel";
import { ClaimsPanel } from "../components/ClaimsPanel";
import { SuggestChip } from "../components/SuggestChip";
import { PageToc, type TocSection } from "../components/PageToc";
import { PageLoading } from "../components/PageLoading";
import { beginLoad } from "../lib/loading";
import {
  fetchCatalog,
  fetchTranscript,
  fetchVideoNlp,
  fetchClaims,
  fetchClaimsIndex,
  fetchContradictions,
  invalidateClaimsCaches,
} from "../lib/data";
import { fmtDate, fmtTimestamp } from "../lib/format";
import type {
  VideoRow,
  Transcript,
  VideoNlp,
  PersistedClaims,
  ClaimsIndexEntry,
  ClaimContradiction,
} from "../types";

export function VideoDetailPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const nav = useNavigate();
  const openVideo = useOpenVideo();
  const [row, setRow] = useState<VideoRow | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [nlp, setNlp] = useState<VideoNlp | null>(null);
  const [claims, setClaims] = useState<PersistedClaims | null>(null);
  const [claimIndex, setClaimIndex] = useState<ClaimsIndexEntry[] | null>(null);
  const [corpusIndex, setCorpusIndex] = useState<ClaimsIndexEntry[] | null>(null);
  const [videoContradictions, setVideoContradictions] = useState<ClaimContradiction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const refreshClaims = () => { invalidateClaimsCaches(); setReloadTick((t) => t + 1); };

  useEffect(() => {
    if (!videoId) return;
    // When the user follows a link into a different video, always land
    // at the top of the page — not at whatever scroll position the
    // previous video was left in. Uses "auto" rather than "smooth" so
    // the jump is instant; the page is about to repaint anyway.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setLoading(true);
    setRow(null);
    setTranscript(null);
    setNlp(null);
    setClaims(null);
    setClaimIndex(null);
    setCorpusIndex(null);
    setVideoContradictions(null);

    const endLoad = beginLoad();
    Promise.allSettled([
      fetchCatalog().then((rows) => {
        const found = rows.find((r) => r.videoId === videoId);
        setRow(found || null);
        setLoading(false);
      }),
      fetchTranscript(videoId).then(setTranscript),
      fetchVideoNlp(videoId).then(setNlp),
      fetchClaims(videoId).then(setClaims),
      fetchClaimsIndex().then((idx) => {
        if (!idx) {
          setClaimIndex([]);
          setCorpusIndex([]);
          return;
        }
        setClaimIndex(idx.claims.filter((c) => c.videoId === videoId));
        setCorpusIndex(idx.claims);
      }),
      fetchContradictions().then((cx) => {
        if (!cx) return setVideoContradictions([]);
        // Keep any contradiction that touches a claim belonging to this video.
        // Claim ids start with "<videoId>:".
        setVideoContradictions(
          cx.contradictions.filter(
            (c) => c.left.startsWith(`${videoId}:`) || c.right.startsWith(`${videoId}:`),
          ),
        );
      }),
    ]).finally(endLoad);
  }, [videoId, reloadTick]);

  if (loading) return <PageLoading label="loading video…" />;
  if (!row) return <Container sx={{ py: 3 }}><Typography color="error">Video not found</Typography></Container>;

  const cues = transcript?.cues || [];
  const metaLine = [
    row.channel,
    fmtDate(row.publishDate || row.uploadDate),
    row.lengthSeconds && `${Math.floor(row.lengthSeconds / 60)}m`,
    row.viewCount && `${row.viewCount.toLocaleString()} views`,
  ].filter(Boolean).join(" · ");

  // Table-of-contents sections for the right rail. Claims / contradictions
  // counts show in the rail so the user can see at a glance what's there
  // before scrolling. Entries whose target section won't render are
  // filtered out.
  const entityCount = nlp?.entities.length ?? 0;
  const relationshipCount = nlp?.relationships.length ?? 0;
  const claimCount = claims?.claims.length ?? 0;
  const contradictionCount = videoContradictions?.length ?? 0;
  const tocSections: TocSection[] = [
    { id: "video-header", label: "overview" },
    ...(row.description ? [{ id: "video-description", label: "description" } as TocSection] : []),
    ...(transcript && entityCount > 0
      ? [{ id: "video-entities", label: "entities", count: entityCount } as TocSection]
      : []),
    ...(transcript && relationshipCount > 0
      ? [{ id: "video-relationships", label: "relationships", count: relationshipCount } as TocSection]
      : []),
    ...(transcript
      ? [{
          id: "video-claims",
          label: "claims",
          count: claimCount,
        } as TocSection]
      : []),
    ...(transcript && contradictionCount > 0
      ? [{ id: "video-contradictions", label: "contradictions", count: contradictionCount } as TocSection]
      : []),
    ...(transcript
      ? [{ id: "video-transcript", label: "transcript" } as TocSection]
      : []),
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Button size="small" onClick={() => nav("/")}>← back</Button>
      {/* Flex row intentionally does NOT set alignItems: flex-start — we
          want the TOC column to stretch to the row's height so its
          position:sticky child has room to stick through the scroll. */}
      <Box sx={{ mt: 2, display: "flex", gap: 3 }}>
        {/* Main content column */}
        <Box sx={{ flex: 1, minWidth: 0, maxWidth: 960 }}>
          <Box id="video-header" sx={{ scrollMarginTop: "80px" }}>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
              {row.thumbnailUrl && (
                <Box
                  component="button"
                  type="button"
                  onClick={() => openVideo({ videoId: row.videoId, title: row.title, sourceUrl: row.sourceUrl })}
                  aria-label={`play ${row.title || row.videoId}`}
                  sx={{
                    flexShrink: 0,
                    p: 0,
                    border: 0,
                    bgcolor: "transparent",
                    cursor: "pointer",
                    borderRadius: 1,
                    "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
                  }}
                >
                  <img src={row.thumbnailUrl} alt="" style={{ width: 320, maxWidth: "100%", height: "auto", display: "block", borderRadius: 4 }} />
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Typography variant="h5">{row.title || row.videoId}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{metaLine}</Typography>
                <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {(row.keywords || []).slice(0, 20).map((k) => (
                    <Chip key={k} size="small" label={k} variant="outlined" clickable onClick={() => nav("/?search=" + encodeURIComponent(k))} />
                  ))}
                  <SuggestChip area="new tag" videoId={row.videoId} label="suggest tag…" />
                </Box>
              </Box>
            </Box>
          </Box>

          {row.description && (
            <Box id="video-description" sx={{ scrollMarginTop: "80px" }}>
              <Typography variant="body2" sx={{ mt: 2, whiteSpace: "pre-wrap" }}>
                {row.description.slice(0, 1000)}
              </Typography>
            </Box>
          )}

          {!transcript && <Typography sx={{ mt: 2 }}>no transcript available</Typography>}

          {transcript && (
            // NlpPanel renders both entities and relationships; we wrap
            // with a pair of scroll-target anchors so the TOC can jump
            // to either. The panel itself lays them out in order.
            <Box sx={{ position: "relative" }}>
              <Box id="video-entities" sx={{ position: "absolute", top: -80 }} aria-hidden />
              <Box id="video-relationships" sx={{ position: "absolute", top: -40 }} aria-hidden />
              <NlpPanel videoId={row.videoId} nlp={nlp} />
            </Box>
          )}

          {transcript && (
            <Box id="video-claims" sx={{ scrollMarginTop: "80px" }}>
              <ClaimsPanel
                videoId={row.videoId}
                claims={claims}
                indexEntries={claimIndex ?? undefined}
                contradictions={videoContradictions ?? undefined}
                corpusIndex={corpusIndex ?? undefined}
                onMutated={refreshClaims}
              />
            </Box>
          )}

          {/* Contradictions anchor — the list currently lives inside the
              claim rows, so jumping here lands on the top of the claims
              section which surfaces the ⚠ badges. Good enough for TOC. */}
          {transcript && contradictionCount > 0 && (
            <Box id="video-contradictions" aria-hidden sx={{ scrollMarginTop: "80px" }} />
          )}

          {transcript && (
            <Box id="video-transcript" sx={{ scrollMarginTop: "80px" }}>
              <Paper sx={{ mt: 2, p: 2, maxHeight: "70vh", overflow: "auto" }}>
                {cues.map((c, i) => (
                  <Box key={i} sx={{ py: 0.5 }}>
                    <Link
                      component="button"
                      type="button"
                      underline="hover"
                      onClick={() => openVideo({ videoId: row.videoId, title: row.title, sourceUrl: row.sourceUrl, timeStart: c.start })}
                    >
                      [{fmtTimestamp(c.start)}]
                    </Link>
                    {" " + c.text}
                  </Box>
                ))}
              </Paper>
              <Box sx={{ mt: 1 }}>
                <SuggestChip area="transcript correction" videoId={row.videoId} label="suggest correction…" />
              </Box>
            </Box>
          )}
        </Box>

        {/* Right-rail TOC — hidden on narrow viewports. We let this
            column stretch to the row's height so the sticky child has
            space to stick against. */}
        <Box
          sx={{
            display: { xs: "none", lg: "block" },
            width: 200,
            flexShrink: 0,
          }}
        >
          <PageToc sections={tocSections} />
        </Box>
      </Box>
    </Container>
  );
}
