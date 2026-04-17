import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Typography, Box, Paper, Button, Link, Chip } from "@mui/material";
import { NlpPanel } from "../components/NlpPanel";
import { SuggestChip } from "../components/SuggestChip";
import { fetchCatalog, fetchTranscript, fetchVideoNlp } from "../lib/data";
import { fmtDate, fmtTimestamp } from "../lib/format";
import type { VideoRow, Transcript, VideoNlp } from "../types";

export function VideoDetailPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const nav = useNavigate();
  const [row, setRow] = useState<VideoRow | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [nlp, setNlp] = useState<VideoNlp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!videoId) return;
    setLoading(true);
    setRow(null);
    setTranscript(null);
    setNlp(null);

    fetchCatalog().then((rows) => {
      const found = rows.find((r) => r.videoId === videoId);
      setRow(found || null);
      setLoading(false);
    });
    fetchTranscript(videoId).then(setTranscript);
    fetchVideoNlp(videoId).then(setNlp);
  }, [videoId]);

  if (loading) return <Container sx={{ py: 3 }}><Typography>loading...</Typography></Container>;
  if (!row) return <Container sx={{ py: 3 }}><Typography color="error">Video not found</Typography></Container>;

  const cues = transcript?.cues || [];
  const metaLine = [
    row.channel,
    fmtDate(row.publishDate || row.uploadDate),
    row.lengthSeconds && `${Math.floor(row.lengthSeconds / 60)}m`,
    row.viewCount && `${row.viewCount.toLocaleString()} views`,
  ].filter(Boolean).join(" · ");

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Button size="small" onClick={() => nav("/")}>← back</Button>
      <Box sx={{ mt: 2, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        {row.thumbnailUrl && (
          <Link href={row.sourceUrl || ("https://www.youtube.com/watch?v=" + row.videoId)} target="_blank" rel="noopener" sx={{ flexShrink: 0 }}>
            <img src={row.thumbnailUrl} alt="" style={{ width: 320, maxWidth: "100%", height: "auto", display: "block", borderRadius: 4 }} />
          </Link>
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
      {row.description && (
        <Typography variant="body2" sx={{ mt: 2, whiteSpace: "pre-wrap" }}>{row.description.slice(0, 1000)}</Typography>
      )}
      {!transcript && <Typography sx={{ mt: 2 }}>no transcript available</Typography>}
      {transcript && <NlpPanel videoId={row.videoId} nlp={nlp} />}
      {transcript && (
        <>
          <Paper sx={{ mt: 2, p: 2, maxHeight: "70vh", overflow: "auto" }}>
            {cues.map((c, i) => (
              <Box key={i} sx={{ py: 0.5 }}>
                <Link
                  href={"https://www.youtube.com/watch?v=" + row.videoId + "&t=" + Math.floor(c.start) + "s"}
                  target="_blank"
                  underline="hover"
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
        </>
      )}
    </Container>
  );
}
