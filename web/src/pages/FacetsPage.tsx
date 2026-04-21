import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Typography, Box, CircularProgress, Alert } from "@mui/material";
import { loadFacetData, activeVideoIds, type FacetBundle } from "../components/facets/duck";
import { useSelectionState } from "../components/facets/state";
import { FacetGroup } from "../components/facets/FacetGroup";
import { ChipBar } from "../components/facets/ChipBar";
import { SimpleVideoTable } from "../components/SimpleVideoTable";
import { PageToc, type TocSection } from "../components/PageToc";
import { beginLoad } from "../lib/loading";

// Stable section id for a facet type, so TOC anchor scroll works.
function typeAnchor(type: string): string {
  return `facet-${type.replace(/[^a-z0-9_-]/gi, "-")}`;
}

export function FacetsPage() {
  const nav = useNavigate();
  const [bundle, setBundle] = useState<FacetBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selection, ensureType, toggle, setGroup, removeGroup, clearAll } = useSelectionState();

  useEffect(() => {
    let cancelled = false;
    const endLoad = beginLoad();
    loadFacetData()
      .then((b) => { if (!cancelled) setBundle(b); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(endLoad);
    return () => { cancelled = true; };
  }, []);

  const activeRows = useMemo(() => {
    if (!bundle) return [];
    const active = activeVideoIds(bundle, selection);
    return bundle.videos
      .filter((r) => active.has(r.videoId))
      .sort((a, b) => {
        const ta = a.publishDate ? Date.parse(a.publishDate) : 0;
        const tb = b.publishDate ? Date.parse(b.publishDate) : 0;
        return tb - ta;
      });
  }, [bundle, selection]);

  if (error) {
    return (
      <Container sx={{ py: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }
  if (!bundle) {
    return (
      <Container sx={{ py: 3, textAlign: "center" }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }} color="text.secondary">Loading facet data…</Typography>
      </Container>
    );
  }

  const TIME_GROUP = new Set([
    "decade", "year", "specific_month", "specific_week",
    "time_of_day", "specific_date_time",
  ]);
  const timeTypes = bundle.typesInOrder.filter((t) => TIME_GROUP.has(t));
  const otherTypes = bundle.typesInOrder.filter((t) => !TIME_GROUP.has(t));

  // TOC: top-level anchors + one per facet type. Type names are the
  // group ids (e.g. "person", "organization") so the label matches the
  // on-page heading.
  const tocSections: TocSection[] = [
    { id: "facets-selection", label: "selection" },
    ...(timeTypes.length > 0
      ? [{ id: "facets-time-group", label: "time" } as TocSection]
      : []),
    ...otherTypes.map((t) => ({ id: typeAnchor(t), label: t })),
    { id: "facets-matches", label: "matching videos", count: activeRows.length },
  ];

  return (
    <Container maxWidth="xl" sx={{ py: 1.5 }}>
      {/* Flex row without alignItems so the TOC column stretches to
          match the main column; the TOC's sticky child then has room
          to stick through scroll. */}
      <Box sx={{ display: "flex", gap: 3 }}>
        {/* Main content column */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 0.5 }}>
            <Typography variant="h6" sx={{ m: 0 }}>Entity Facets</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
              click a bar to filter · select one to spawn a co-occurrence slot · drag on time charts to brush
            </Typography>
          </Box>
          <Box id="facets-selection" sx={{ scrollMarginTop: "80px" }}>
            <ChipBar selection={selection} bundle={bundle} onToggle={toggle} onClearAll={clearAll} />
          </Box>
          {timeTypes.length > 0 && (
            <Box id="facets-time-group" sx={{ scrollMarginTop: "80px" }}>
              <Box
                sx={{
                  mt: 0.5,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 1,
                }}
              >
                {timeTypes.map((type) => (
                  <FacetGroup
                    key={type}
                    type={type}
                    selection={selection}
                    bundle={bundle}
                    onToggle={toggle}
                    onSetGroup={setGroup}
                    onRemoveSlot={removeGroup}
                    onEnsureType={ensureType}
                  />
                ))}
              </Box>
            </Box>
          )}
          <Box sx={{ mt: 0.5 }}>
            {otherTypes.map((type) => (
              <Box
                key={type}
                id={typeAnchor(type)}
                sx={{ scrollMarginTop: "80px" }}
              >
                <FacetGroup
                  type={type}
                  selection={selection}
                  bundle={bundle}
                  onToggle={toggle}
                  onSetGroup={setGroup}
                  onRemoveSlot={removeGroup}
                  onEnsureType={ensureType}
                />
              </Box>
            ))}
          </Box>
          <Box id="facets-matches" sx={{ mt: 2, scrollMarginTop: "80px" }}>
            <SimpleVideoTable rows={activeRows} title={activeRows.length + " videos match"} />
          </Box>
        </Box>

        {/* Right-rail TOC — hidden on narrow viewports. */}
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
