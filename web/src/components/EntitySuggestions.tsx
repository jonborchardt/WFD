import { useState, useEffect } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { ENTITY_TYPE_COLOR } from "./catalog-columns";
import { fetchEntityIndex, fetchEntityVideos, fetchCatalog } from "../lib/data";
import { searchEntityIndex, filterRows, sortByPublishDesc, paginate } from "../lib/query";
import { fmtDate } from "../lib/format";
import type { EntityIndexEntry, VideoRow } from "../types";

interface SuggestionsResult {
  entities: EntityIndexEntry[];
  videos: VideoRow[];
  videoTotal: number;
}

function useUnifiedSuggestions(text: string): SuggestionsResult | null {
  const [results, setResults] = useState<SuggestionsResult | null>(null);
  useEffect(() => {
    const q = text.trim();
    if (!q) { setResults(null); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      const [index, evIndex, catalog] = await Promise.all([
        fetchEntityIndex(),
        fetchEntityVideos(),
        fetchCatalog(),
      ]);
      if (cancelled) return;
      const entities = searchEntityIndex(index, { q, limit: 8 });
      const fetched = catalog.filter((r) => r.status === "fetched");
      let matched = filterRows(fetched, { text: q });
      matched = sortByPublishDesc(matched);
      const paged = paginate(matched, { page: 1, pageSize: 6 });
      setResults({ entities, videos: paged.rows, videoTotal: paged.total });
    }, 150);
    return () => { cancelled = true; clearTimeout(h); };
  }, [text]);
  return results;
}

interface Props {
  text: string;
  onNavigate: (to: string) => void;
  onPick?: () => void;
}

export function EntitySuggestions({ text, onNavigate, onPick }: Props) {
  const results = useUnifiedSuggestions(text);
  const q = text.trim();
  if (!q || !results) return null;
  const { entities, videos, videoTotal } = results;

  const filterRow = (
    <Box
      sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderBottom: 1, borderColor: "divider" }}
      onClick={() => { onPick?.(); onNavigate("/?search=" + encodeURIComponent(q)); }}
    >
      <Typography sx={{ flexGrow: 1 }}>
        All Videos with "<b>{q}</b>"
      </Typography>
      <Typography variant="caption" color="text.secondary">press enter</Typography>
    </Box>
  );

  if (entities.length === 0 && videos.length === 0) {
    return (
      <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.default" }}>
        {filterRow}
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">no entities or videos match</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "background.default", maxHeight: 420, overflow: "auto" }}>
      {filterRow}
      {entities.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 1, display: "block" }}>
            entities
          </Typography>
          {entities.map((r) => (
            <Box
              key={r.id}
              sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              onClick={() => { onPick?.(); onNavigate("/entity/" + encodeURIComponent(r.id)); }}
            >
              <Chip size="small" label={r.type} color={ENTITY_TYPE_COLOR[r.type] || "default"} />
              <Typography sx={{ flexGrow: 1 }}>{r.canonical}</Typography>
              <Typography variant="caption" color="text.secondary">
                {r.mentionCount} mention{r.mentionCount === 1 ? "" : "s"} · {r.videoCount} video{r.videoCount === 1 ? "" : "s"}
              </Typography>
            </Box>
          ))}
        </>
      )}
      {videos.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 1, display: "block", borderTop: entities.length > 0 ? 1 : 0, borderColor: "divider", mt: entities.length > 0 ? 0.5 : 0 }}>
            videos ({videoTotal})
          </Typography>
          {videos.map((v) => (
            <Box
              key={v.videoId}
              sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              onClick={() => { onPick?.(); onNavigate("/video/" + v.videoId); }}
            >
              {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" width="48" height="27" style={{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />}
              <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
                <Typography variant="body2" noWrap>{v.title || v.videoId}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[v.channel, fmtDate(v.publishDate)].filter(Boolean).join(" · ")}
                </Typography>
              </Box>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
