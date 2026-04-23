import { Alert, AlertTitle, Container, Link, Stack, Typography } from "@mui/material";
import { UpstreamCheck } from "../components/UpstreamCheck";
import { AdminCatalogTable } from "../components/AdminCatalogTable";
import type { VideoRow } from "../types";

export function AdminPage() {
  // Admin video detail pages are server-rendered HTML — full-page nav
  const handleRowClick = (r: VideoRow) => {
    window.location.href = "/admin/video/" + r.videoId;
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom>Admin</Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
        <Link href="/admin/aliases">aliases</Link>
        <Link href="/admin/metrics">metrics</Link>
        <Link href="/contradictions">contradictions (incl. pending-verify)</Link>
        <Link href="/cross-video-agreements">cross-video agreements</Link>
        <Link href="/claims">claims</Link>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle>Known issue — counter-evidence propagation</AlertTitle>
        Claims with a populated <strong>counterEvidence</strong> field
        (intra-video "evidence against" edges — 216 claims, 242 rows as
        of the last rebuild) render the counter-claims in the UI, but
        they don't move the target's <code>derivedTruth</code> when the
        target's <code>directTruth ≥ 0.7</code>. The propagation
        coupling in{" "}
        <code>src/truth/claim-propagation.ts</code> (alternative at
        half-weight, undercuts as a cap at{" "}
        <code>1 − 0.2·sourceTruth·sourceConfidence</code>) is too
        weak relative to the directTruth anchor. Flagged by plan3
        agent A9 (33% of sampled edges show zero propagation effect,
        concentrated on high-confidence targets). Decision pending:
        tighten coupling, or leave the score pinned and have the UI
        surface a "no effect" note next to the panel.
      </Alert>

      <UpstreamCheck />
      <AdminCatalogTable onRowClick={handleRowClick} />
    </Container>
  );
}
