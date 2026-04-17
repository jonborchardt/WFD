import { Container, Typography } from "@mui/material";
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
      <UpstreamCheck />
      <AdminCatalogTable onRowClick={handleRowClick} />
    </Container>
  );
}
