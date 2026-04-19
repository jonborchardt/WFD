import { useNavigate } from "react-router-dom";
import { Box, Typography, Chip, Link } from "@mui/material";
import { ENTITY_TYPE_COLOR } from "./catalog-columns";
import { SuggestChip } from "./SuggestChip";
import { EntityMenuButton, RelationMenuButton } from "./EntityMenu";
import { fmtTimestamp, deepLink } from "../lib/format";
import { isVisibleType } from "../lib/entity-visibility";
import type { VideoNlp } from "../types";

// Split an entity id like "person:dan brown" into { label, canonical }.
function splitEntityId(id: string): { label: string; canonical: string } {
  const idx = id.indexOf(":");
  if (idx < 0) return { label: "misc", canonical: id };
  return { label: id.slice(0, idx), canonical: id.slice(idx + 1) };
}

interface Props {
  videoId: string;
  nlp: VideoNlp | null;
}

export function NlpPanel({ videoId, nlp }: Props) {
  const nav = useNavigate();
  if (!nlp) return <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>analyzing transcript…</Typography>;

  const { entities, relationships } = nlp;
  const byType: Record<string, typeof entities> = {};
  for (const e of entities) {
    if (!isVisibleType(e.type)) continue;
    (byType[e.type] ||= []).push(e);
  }
  const order = ["person", "organization", "location", "misc", "time"].filter(isVisibleType);
  const extraTypes = Object.keys(byType).filter((t) => !order.includes(t)).sort();
  const visibleTypes = [...order, ...extraTypes];
  const visibleEntityCount = visibleTypes.reduce((n, t) => n + (byType[t]?.length || 0), 0);
  const visibleMentionCount = visibleTypes.reduce(
    (n, t) => n + (byType[t]?.reduce((m, e) => m + e.mentions.length, 0) || 0),
    0,
  );
  const entById = Object.fromEntries(entities.map((e) => [e.id, e]));

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Entities{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {visibleEntityCount} unique · {visibleMentionCount} mentions
        </Typography>
      </Typography>
      {visibleTypes.map((t) => (
        <Box key={t} sx={{ mb: 1.5 }}>
          <Typography variant="overline" color="text.secondary">{t}</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {(byType[t] || [])
              .slice()
              .sort((a, b) => b.mentions.length - a.mentions.length || a.canonical.localeCompare(b.canonical, undefined, { numeric: true, sensitivity: "base" }))
              .map((e) => {
                const split = splitEntityId(e.id);
                return (
                  <Box key={e.id} sx={{ display: "inline-flex", alignItems: "center" }}>
                    <Chip
                      size="small"
                      color={ENTITY_TYPE_COLOR[t] || "default"}
                      variant="outlined"
                      label={e.canonical}
                      clickable
                      onClick={(ev) => {
                        if (ev.shiftKey) return; // shift+click opens menu via the button
                        nav("/entity/" + encodeURIComponent(e.id));
                      }}
                    />
                    <EntityMenuButton
                      entity={{ key: e.id, canonical: e.canonical, label: split.label }}
                      videoId={videoId}
                      where={`/video/${videoId}`}
                    />
                  </Box>
                );
              })}
            <SuggestChip area={"new " + t} videoId={videoId} label={"suggest " + t + "\u2026"} />
          </Box>
        </Box>
      ))}

      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
        Relationships{" "}
        <Typography component="span" variant="caption" color="text.secondary">{relationships.length}</Typography>
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {relationships
          .slice()
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 50)
          .map((r) => {
            const s = entById[r.subjectId];
            const o = entById[r.objectId];
            if (!s || !o || !r.evidence) return null;
            return (
              <Box key={r.id} sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 14 }}>
                <Link href={deepLink(videoId, r.evidence.timeStart)} target="_blank" underline="hover" sx={{ fontFamily: "monospace", fontSize: 12 }}>
                  [{fmtTimestamp(r.evidence.timeStart)}]
                </Link>
                <Chip size="small" label={s.canonical} variant="outlined" color={ENTITY_TYPE_COLOR[s.type] || "default"} clickable onClick={() => nav("/entity/" + encodeURIComponent(s.id))} />
                <Typography variant="caption" color="text.secondary">{r.predicate}</Typography>
                <Chip size="small" label={o.canonical} variant="outlined" color={ENTITY_TYPE_COLOR[o.type] || "default"} clickable onClick={() => nav("/entity/" + encodeURIComponent(o.id))} />
                <Typography variant="caption" color="text.secondary">{r.confidence.toFixed(2)}</Typography>
                <RelationMenuButton
                  videoId={videoId}
                  relation={{
                    subject: { key: s.id, canonical: s.canonical, label: s.type },
                    predicate: r.predicate,
                    object: { key: o.id, canonical: o.canonical, label: o.type },
                    timeStart: r.evidence.timeStart,
                  }}
                />
              </Box>
            );
          })}
        <Box sx={{ mt: 0.5 }}>
          <SuggestChip area="new relationship" videoId={videoId} label="suggest relationship…" />
        </Box>
      </Box>
    </Box>
  );
}
