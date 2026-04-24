import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  Box, Dialog, IconButton, Link, Typography,
  useMediaQuery, useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export interface OpenVideoArgs {
  videoId: string;
  timeStart?: number;
  title?: string;
  // Non-YouTube sources fall through to a new-tab open.
  sourceUrl?: string;
}

type VideoLightboxContextValue = (args: OpenVideoArgs) => void;

const VideoLightboxContext = createContext<VideoLightboxContextValue | null>(null);

export function useOpenVideo(): VideoLightboxContextValue {
  const ctx = useContext(VideoLightboxContext);
  if (!ctx) throw new Error("useOpenVideo must be used inside <VideoLightboxProvider>");
  return ctx;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function youTubeWatchUrl(videoId: string, timeStart?: number): string {
  const t = timeStart ? `&t=${Math.floor(timeStart)}s` : "";
  return `https://www.youtube.com/watch?v=${videoId}${t}`;
}

function youTubeEmbedUrl(videoId: string, timeStart?: number): string {
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
  });
  if (timeStart && timeStart > 0) params.set("start", String(Math.floor(timeStart)));
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function VideoLightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenVideoArgs | null>(null);

  const openVideo = useCallback<VideoLightboxContextValue>((args) => {
    if (args.sourceUrl && !isYouTubeUrl(args.sourceUrl)) {
      window.open(args.sourceUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setState(args);
  }, []);

  const close = useCallback(() => setState(null), []);

  return (
    <VideoLightboxContext.Provider value={openVideo}>
      {children}
      <VideoLightbox open={!!state} args={state} onClose={close} />
    </VideoLightboxContext.Provider>
  );
}

interface VideoLightboxProps {
  open: boolean;
  args: OpenVideoArgs | null;
  onClose: () => void;
}

function VideoLightbox({ open, args, onClose }: VideoLightboxProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const videoId = args?.videoId;
  const timeStart = args?.timeStart;
  const title = args?.title;
  const watchUrl = videoId ? youTubeWatchUrl(videoId, timeStart) : "";
  const embedUrl = videoId ? youTubeEmbedUrl(videoId, timeStart) : "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      fullScreen={fullScreen}
      PaperProps={{
        sx: {
          width: fullScreen ? "100%" : "92vw",
          maxWidth: 1400,
          m: fullScreen ? 0 : 2,
          bgcolor: "background.paper",
        },
      }}
      slotProps={{ backdrop: { sx: { backgroundColor: (t) => alpha(t.palette.common.black, 0.85) } } }}
    >
      <Box sx={{ position: "relative" }}>
        <IconButton
          aria-label="close video"
          onClick={onClose}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            bgcolor: (t) => alpha(t.palette.common.black, 0.55),
            color: "common.white",
            "&:hover": { bgcolor: (t) => alpha(t.palette.common.black, 0.75) },
          }}
        >
          <CloseIcon />
        </IconButton>
        <Box sx={{ position: "relative", width: "100%", pt: "56.25%", bgcolor: "common.black" }}>
          {/* Iframe is gated on `open` (not just `videoId`) so audio stops
              immediately on close instead of bleeding through the Dialog
              fade-out transition. */}
          {open && videoId && (
            <Box
              component="iframe"
              key={`${videoId}:${timeStart ?? 0}`}
              src={embedUrl}
              title={title || "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
              }}
            />
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            px: 2,
            py: 1,
          }}
        >
          <Typography variant="body2" color="text.secondary" noWrap title={title}>
            {title || videoId}
          </Typography>
          {videoId && (
            <Link
              href={watchUrl}
              target="_blank"
              rel="noopener"
              underline="hover"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 13, flexShrink: 0 }}
            >
              open on YouTube <OpenInNewIcon sx={{ fontSize: 14 }} />
            </Link>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
