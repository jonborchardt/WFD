import { Container, Typography, Stack, Link } from "@mui/material";
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
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <Link href="/admin/aliases">aliases</Link>
        <Link href="/admin/metrics">metrics</Link>
      </Stack>
      <UpstreamCheck />
      <AdminCatalogTable onRowClick={handleRowClick} />
    </Container>
  );
}
