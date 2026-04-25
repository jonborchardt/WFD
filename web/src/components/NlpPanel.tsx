import { useNavigate } from "react-router-dom";
import { Box, Typography, Chip, Link, Tooltip, Accordion, AccordionSummary, AccordionDetails, useTheme } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { ENTITY_TYPE_COLOR } from "./catalog-columns";
import { SuggestChip } from "./SuggestChip";
import { EntityWordCloud } from "./EntityWordCloud";
import { EntityMenuButton, RelationMenuButton } from "./EntityMenu";
import { useOpenVideo } from "./VideoLightbox";
import { fmtTimestamp } from "../lib/format";
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
  const openVideo = useOpenVideo();
  const theme = useTheme();
  const entityPalette = (theme.palette as unknown as { entity?: Record<string, string> }).entity;
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
      <EntityWordCloud nlp={nlp} />
      {visibleTypes.map((t) => {
        const items = byType[t] || [];
        const mentionTotal = items.reduce((n, e) => n + e.mentions.length, 0);
        const typeHex = entityPalette?.[t];
        return (
          <Accordion
            key={t}
            disableGutters
            elevation={0}
            square
            sx={{
              "&:before": { display: "none" },
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: "transparent",
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon fontSize="small" />}
              sx={{ minHeight: 0, px: 0, "& .MuiAccordionSummary-content": { my: 0.5 } }}
            >
              <Typography
                variant="overline"
                sx={{
                  lineHeight: 1.5,
                  color: entityPalette?.[t] ?? "text.secondary",
                  fontWeight: 600,
                }}
              >
                {t}{" "}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
                  {items.length} · {mentionTotal} mentions
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0, pb: 1 }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {items
                  .slice()
                  .sort((a, b) => b.mentions.length - a.mentions.length || a.canonical.localeCompare(b.canonical, undefined, { numeric: true, sensitivity: "base" }))
                  .map((e) => {
                    const split = splitEntityId(e.id);
                    return (
                      <Box key={e.id} sx={{ display: "inline-flex", alignItems: "center" }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          // Drive the chip color from the same entity palette as
                          // the section title, so every type — not just the seven
                          // mapped in ENTITY_TYPE_COLOR — gets a colored chip.
                          sx={typeHex ? {
                            borderColor: typeHex,
                            color: typeHex,
                            "& .MuiChip-label": { color: typeHex },
                          } : undefined}
                          color={typeHex ? undefined : (ENTITY_TYPE_COLOR[t] || "default")}
                          label={
                            <Box component="span" sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.5 }}>
                              <span>{e.canonical}</span>
                              <Box component="span" sx={{ color: "text.secondary", fontSize: "0.75em" }}>
                                {e.mentions.length}
                              </Box>
                            </Box>
                          }
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
            </AccordionDetails>
          </Accordion>
        );
      })}

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
            const sHex = entityPalette?.[s.type];
            const oHex = entityPalette?.[o.type];
            const hexChipSx = (hex: string | undefined) => hex ? {
              borderColor: hex,
              color: hex,
              "& .MuiChip-label": { color: hex },
            } : undefined;
            return (
              <Box key={r.id} sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 14 }}>
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => openVideo({ videoId, timeStart: r.evidence!.timeStart })}
                  sx={{ fontFamily: "monospace", fontSize: 12 }}
                >
                  [{fmtTimestamp(r.evidence.timeStart)}]
                </Link>
                <Chip
                  size="small"
                  label={s.canonical}
                  variant="outlined"
                  sx={hexChipSx(sHex)}
                  color={sHex ? undefined : (ENTITY_TYPE_COLOR[s.type] || "default")}
                  clickable
                  onClick={() => nav("/entity/" + encodeURIComponent(s.id))}
                />
                <Typography variant="caption" color="text.secondary">{r.predicate}</Typography>
                <Chip
                  size="small"
                  label={o.canonical}
                  variant="outlined"
                  sx={hexChipSx(oHex)}
                  color={oHex ? undefined : (ENTITY_TYPE_COLOR[o.type] || "default")}
                  clickable
                  onClick={() => nav("/entity/" + encodeURIComponent(o.id))}
                />
                <Tooltip
                  arrow
                  title={
                    <Box sx={{ fontSize: 12, lineHeight: 1.4 }}>
                      GLiREL's score that the predicate
                      <strong> {r.predicate}</strong> holds between
                      these two entities, given the evidence sentence
                      at the timestamp on the left. Higher = stronger
                      model signal; not a truth judgment.
                    </Box>
                  }
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ cursor: "help", textDecoration: "underline dotted" }}
                  >
                    {r.confidence.toFixed(2)}
                  </Typography>
                </Tooltip>
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
