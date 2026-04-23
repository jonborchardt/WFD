import { useState, useEffect } from "react";
import { Box, Alert, AlertTitle, Link } from "@mui/material";
import { fmtDate } from "../lib/format";
import { useOpenVideo } from "./VideoLightbox";

interface ChannelCheck {
  channelId: string;
  channelLabel: string;
  upstream: { videoId: string; title: string; publishedAt: string } | null;
  catalog: { videoId: string; title?: string; publishDate?: string } | null;
  behind: boolean;
  error?: string;
}

export function UpstreamCheck() {
  const openVideo = useOpenVideo();
  const [state, setState] = useState<{ loading: boolean; channels: ChannelCheck[] }>({ loading: true, channels: [] });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/upstream-check")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setState({ loading: false, channels: d.channels || [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, channels: [] }); });
    return () => { cancelled = true; };
  }, []);

  if (state.loading) return null;

  return (
    <Box sx={{ mb: 2 }}>
      {state.channels.map((c) => {
        if (c.error) {
          return (
            <Alert key={c.channelId} severity="warning" sx={{ mb: 1 }}>
              {c.channelLabel}: upstream check failed — {c.error}
            </Alert>
          );
        }
        if (c.behind && c.upstream) {
          const upDate = fmtDate(c.upstream.publishedAt);
          const catDate = c.catalog?.publishDate ? fmtDate(c.catalog.publishDate) : "none";
          const upstream = c.upstream;
          return (
            <Alert key={c.channelId} severity="warning" sx={{ mb: 1 }}>
              <AlertTitle>{c.channelLabel}: new video needs upload</AlertTitle>
              Upstream latest:{" "}
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => openVideo({ videoId: upstream.videoId, title: upstream.title })}
              >
                {upstream.title}
              </Link>{" "}
              ({upDate})
              <Box component="span" sx={{ ml: 1, color: "text.secondary" }}>— catalog latest: {catDate}</Box>
            </Alert>
          );
        }
        if (!c.upstream) {
          return (
            <Alert key={c.channelId} severity="info" sx={{ mb: 1 }}>
              {c.channelLabel}: no upstream video found
            </Alert>
          );
        }
        return (
          <Alert key={c.channelId} severity="success" sx={{ mb: 1 }}>
            {c.channelLabel}: up to date (latest {fmtDate(c.upstream.publishedAt)})
          </Alert>
        );
      })}
    </Box>
  );
}
