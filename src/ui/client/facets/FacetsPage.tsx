// Top-level page. Wires data loading, selection state, facet groups, chip
// bar, and the shared video table.

import { useEffect, useMemo, useState } from "react";
import { Container, Typography, Box, CircularProgress, Alert } from "@mui/material";
import { loadFacetData, activeVideoIds, type FacetBundle } from "./duck.js";
import { useSelectionState } from "./state.js";
import { FacetGroup } from "./FacetGroup.js";
import { ChipBar } from "./ChipBar.js";
import { SimpleVideoTable } from "../shared/simple-video-table.js";

interface Props {
  nav: (to: string) => void;
}

export function FacetsPage({ nav }: Props) {
  const [bundle, setBundle] = useState<FacetBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selection, ensureType, toggle, removeGroup, clearAll } = useSelectionState();

  useEffect(() => {
    let cancelled = false;
    loadFacetData()
      .then((b) => { if (!cancelled) setBundle(b); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
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

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>Entity Facets</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Click bars to filter. Counts are total mentions (not distinct videos).
        Selecting a bar in one facet spawns a second facet of the same type —
        that second facet shows entities that co-occur with the first. Stack
        more to drill deeper.
      </Typography>
      <ChipBar selection={selection} bundle={bundle} onToggle={toggle} onClearAll={clearAll} />
      <Box sx={{ mt: 1 }}>
        {bundle.typesInOrder.map((type) => (
          <FacetGroup
            key={type}
            type={type}
            selection={selection}
            bundle={bundle}
            onToggle={toggle}
            onRemoveSlot={removeGroup}
            onEnsureType={ensureType}
          />
        ))}
      </Box>
      <Box sx={{ mt: 2 }}>
        <SimpleVideoTable rows={activeRows} nav={nav} title={activeRows.length + " videos match"} />
      </Box>
    </Container>
  );
}
