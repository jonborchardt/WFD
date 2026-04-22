// Cross-video agreements page (Plan 04 §D4).
//
// Reads data/claims/consonance.json — SAME-CLAIM verdicts from the
// contradiction verification pass that the verifier identified as
// "same thesis appears in two different videos". Surfaces them as
// positive cross-video corroboration, not contradictions.
//
// Minimal layout on purpose — this is a small surface today (~57
// pairs in the current corpus). If/when the signal grows, promote to
// a faceted rail like /contradictions.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Chip, Stack, TextField, Typography,
} from "@mui/material";
import { PageLoading } from "../components/PageLoading";
import { ContradictionResultRow } from "../components/ContradictionResultRow";
import { loadClaimsBundle, type ClaimsBundle } from "../components/facets/claims-duck";
import { fetchConsonance } from "../lib/data";
import { colors } from "../theme";
import type { ClaimContradiction, ConsonanceFile } from "../types";

export function ConsonancePage() {
  const nav = useNavigate();
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
  const [file, setFile] = useState<ConsonanceFile | null | undefined>(undefined);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([loadClaimsBundle(), fetchConsonance()]).then(([b, f]) => {
      if (!alive) return;
      setBundle(b);
      setFile(f);
    });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo<ClaimContradiction[]>(() => {
    if (!file?.agreements || !bundle) return [];
    const query = q.trim().toLowerCase();
    if (!query) return file.agreements;
    return file.agreements.filter((x) => {
      const l = bundle.claimsById.get(x.left);
      const r = bundle.claimsById.get(x.right);
      const hay = [l?.text ?? "", r?.text ?? "", ...(x.sharedEntities ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }, [file, bundle, q]);

  if (bundle === null || file === undefined) return <PageLoading />;

  return (
    <Box sx={{ p: 2, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="baseline" spacing={2} sx={{ mb: 1 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Cross-video agreements
        </Typography>
        <Chip
          size="small"
          label={`${file?.agreements?.length ?? 0} pairs`}
          sx={{ bgcolor: colors.surface.raised, color: colors.surface.text }}
        />
      </Stack>
      <Typography variant="body2" sx={{ color: colors.surface.textMuted, mb: 2, maxWidth: 760 }}>
        Claim pairs the AI verification pass identified as asserting
        the same thesis across two different videos. These are
        cross-video corroborations, not contradictions — useful for
        seeing where the host returns to the same idea in multiple
        episodes.
      </Typography>

      <TextField
        size="small"
        fullWidth
        placeholder="search claim text or shared entities"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        sx={{ mb: 2, maxWidth: 520 }}
      />

      <Stack spacing={1.5}>
        {filtered.map((x, i) => (
          <ContradictionResultRow
            key={`${x.left}|${x.right}|${i}`}
            cx={x}
            bundle={bundle}
            nav={nav}
            onMutated={() => { /* read-only surface for now */ }}
          />
        ))}
        {filtered.length === 0 && (
          <Typography variant="body2" sx={{ color: colors.surface.textMuted, py: 4, textAlign: "center" }}>
            {q ? "no agreements match this search" : "no cross-video agreements yet — run the contradiction verification pass"}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
