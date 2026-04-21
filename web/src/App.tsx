import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { CircularProgress, Box } from "@mui/material";
import { AppShell } from "./components/AppShell";
import { CatalogPage } from "./pages/CatalogPage";
import { VideoDetailPage } from "./pages/VideoDetailPage";
import { EntityDetailPage } from "./pages/EntityDetailPage";
import { FacetsPage } from "./pages/FacetsPage";
import { AboutPage } from "./pages/AboutPage";
import { ClaimsPage } from "./pages/ClaimsPage";
import { ClaimDetailPage } from "./pages/ClaimDetailPage";
import { ContradictionsPage } from "./pages/ContradictionsPage";
import { IS_ADMIN } from "./lib/admin";

// Lazy-load heavy pages
const RelationshipsPage = lazy(() =>
  import("./pages/RelationshipsPage").then((m) => ({ default: m.RelationshipsPage })),
);
const ClaimGraphPage = lazy(() =>
  import("./pages/ClaimGraphPage").then((m) => ({ default: m.ClaimGraphPage })),
);
const AdminPage = IS_ADMIN
  ? lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })))
  : null;

function Loading() {
  return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<CatalogPage />} />
        <Route path="video/:videoId" element={<VideoDetailPage />} />
        <Route path="entity/:entityId" element={<EntityDetailPage />} />
        <Route path="relationships" element={<Suspense fallback={<Loading />}><RelationshipsPage /></Suspense>} />
        <Route path="claim-graph" element={<Suspense fallback={<Loading />}><ClaimGraphPage /></Suspense>} />
        <Route path="facets" element={<FacetsPage />} />
        <Route path="claims" element={<ClaimsPage />} />
        <Route path="claim/:claimId" element={<ClaimDetailPage />} />
        <Route path="contradictions" element={<ContradictionsPage />} />
        <Route path="about" element={<AboutPage />} />
        {AdminPage && (
          <Route path="admin" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} />
        )}
      </Route>
    </Routes>
  );
}
