import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Container, Typography, Box, Paper, Button, Link, Chip, TextField, Stack } from "@mui/material";
import { ENTITY_TYPE_COLOR } from "../components/catalog-columns";
import { EntitySuggestions } from "../components/EntitySuggestions";
import { PageLoading } from "../components/PageLoading";
import { fetchCatalog, fetchEntityIndex, fetchEntityVideos } from "../lib/data";
import { beginLoad } from "../lib/loading";
import { fmtTimestamp } from "../lib/format";
import type { VideoRow, EntityIndexEntry, TranscriptSpan } from "../types";

interface EntityVideo {
  videoId: string;
  title?: string;
  channel?: string;
  publishDate?: string;
  thumbnailUrl?: string;
  mentions: TranscriptSpan[];
}

export function EntityDetailPage() {
  const { entityId: rawId } = useParams<{ entityId: string }>();
  const entityId = rawId ? decodeURIComponent(rawId) : "";
  const nav = useNavigate();
  const [entity, setEntity] = useState<EntityIndexEntry | null>(null);
  const [videos, setVideos] = useState<EntityVideo[]>([]);
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityId) return;
    setLoading(true);
    const endLoad = beginLoad();
    Promise.all([fetchEntityIndex(), fetchEntityVideos(), fetchCatalog()]).then(([index, ev, catalog]) => {
      const found = index.find((e) => e.id === entityId) || null;
      setEntity(found);
      const refs = ev[entityId] || [];
      const catMap = new Map(catalog.map((r) => [r.videoId, r]));
      const vids: EntityVideo[] = [];
      for (const ref of refs) {
        const row = catMap.get(ref.videoId);
        if (!row) continue;
        vids.push({
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          publishDate: row.publishDate,
          thumbnailUrl: row.thumbnailUrl,
          mentions: ref.mentions,
        });
      }
      vids.sort((a, b) => {
        const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
        const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
      setVideos(vids);
      setLoading(false);
    }).finally(endLoad);
  }, [entityId]);

  if (loading) return <PageLoading label="loading entity…" />;

  const type = entity?.type || entityId.split(":")[0];
  const canonical = entity?.canonical || entityId.split(":").slice(1).join(":");
  const totalMentions = videos.reduce((n, v) => n + v.mentions.length, 0);
  const showingSearch = showDropdown && text.trim().length > 0;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button size="small" onClick={() => nav("/")}>← back</Button>
      <Typography variant="h4" gutterBottom sx={{ mt: 1 }}>Entities</Typography>
      <Paper sx={{ mt: 2, mb: 2, position: "relative" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5 }}>
          <TextField
            size="small"
            placeholder="search entities (people, places, orgs…) or catalog"
            value={text}
            onChange={(e) => { setText(e.target.value); setShowDropdown(true); }}
            onFocus={() => { if (text) setShowDropdown(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) { setShowDropdown(false); nav("/?search=" + encodeURIComponent(text.trim())); }
              else if (e.key === "Escape") setShowDropdown(false);
            }}
            sx={{ flexGrow: 1 }}
            autoFocus
          />
          {text && <Button size="small" onClick={() => { setText(""); setShowDropdown(false); }}>clear</Button>}
          {text && <Button size="small" variant="outlined" onClick={() => { setShowDropdown(false); nav("/?search=" + encodeURIComponent(text.trim())); }}>in catalog</Button>}
        </Box>
        {showDropdown && <EntitySuggestions text={text} onNavigate={nav} onPick={() => { setText(""); setShowDropdown(false); }} />}
      </Paper>
      {!showingSearch && (
        <>
          <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
            <Chip label={type} color={ENTITY_TYPE_COLOR[type] || "default"} size="small" />
            <Typography variant="h4">{canonical}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {totalMentions} mention{totalMentions === 1 ? "" : "s"} across {videos.length} video{videos.length === 1 ? "" : "s"}
          </Typography>
        </>
      )}
      {!showingSearch && videos.length === 0 && <Typography>no videos contain this entity</Typography>}
      {!showingSearch && (
        <Stack spacing={2}>
          {videos.map((v) => (
            <Paper key={v.videoId} sx={{ p: 2 }}>
              <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
                {v.thumbnailUrl && (
                  <img
                    src={v.thumbnailUrl} alt="" width="120" height="68"
                    style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0, cursor: "pointer" }}
                    onClick={() => nav("/video/" + v.videoId)}
                  />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Link component="button" underline="hover" onClick={() => nav("/video/" + v.videoId)} sx={{ textAlign: "left" }}>
                    <Typography variant="subtitle1">{v.title || v.videoId}</Typography>
                  </Link>
                  <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {v.mentions.slice(0, 60).map((m, i) => (
                      <Link
                        key={i}
                        href={"https://www.youtube.com/watch?v=" + v.videoId + "&t=" + Math.floor(m.timeStart) + "s"}
                        target="_blank" rel="noopener" underline="hover"
                        sx={{ fontFamily: "monospace", fontSize: 12 }}
                      >
                        [{fmtTimestamp(m.timeStart)}]
                      </Link>
                    ))}
                    {v.mentions.length > 60 && (
                      <Typography variant="caption" color="text.secondary">+{v.mentions.length - 60} more</Typography>
                    )}
                  </Box>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}
    </Container>
  );
}
