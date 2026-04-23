import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { CircularProgress, Box } from "@mui/material";
import { AppShell } from "./components/AppShell";
import { VideoDetailPage } from "./pages/VideoDetailPage";
import { EntityDetailPage } from "./pages/EntityDetailPage";
import { HomePage } from "./pages/HomePage";
import { HomePage1 } from "./pages/HomePage1";
import { HomePage2 } from "./pages/HomePage2";
import { HomePage3 } from "./pages/HomePage3";
import { HomePage4 } from "./pages/HomePage4";
import { HomePage5 } from "./pages/HomePage5";
import { HomeVariantsPage } from "./pages/HomeVariantsPage";
import { VideosPage } from "./pages/VideosPage";
import { ClaimsPage } from "./pages/ClaimsPage";
import { ClaimDetailPage } from "./pages/ClaimDetailPage";
import { ContradictionsPage } from "./pages/ContradictionsPage";
import { ConsonancePage } from "./pages/ConsonancePage";
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
const MetricsPage = IS_ADMIN
  ? lazy(() => import("./pages/MetricsPage").then((m) => ({ default: m.MetricsPage })))
  : null;

function Loading() {
  return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="home-variants" element={<HomeVariantsPage />} />
        <Route path="home1" element={<HomePage1 />} />
        <Route path="home2" element={<HomePage2 />} />
        <Route path="home3" element={<HomePage3 />} />
        <Route path="home4" element={<HomePage4 />} />
        <Route path="home5" element={<HomePage5 />} />
        <Route path="videos" element={<VideosPage />} />
        <Route path="about" element={<HomePage />} />
        <Route path="video/:videoId" element={<VideoDetailPage />} />
        <Route path="entity/:entityId" element={<EntityDetailPage />} />
        <Route path="entity-graph" element={<Suspense fallback={<Loading />}><RelationshipsPage /></Suspense>} />
        <Route path="argument-map" element={<Suspense fallback={<Loading />}><ClaimGraphPage /></Suspense>} />
        <Route path="claims" element={<ClaimsPage />} />
        <Route path="claim/:claimId" element={<ClaimDetailPage />} />
        <Route path="contradictions" element={<ContradictionsPage />} />
        <Route path="cross-video-agreements" element={<ConsonancePage />} />
        {/* Kept as aliases so existing bookmarks and any stashed
            "graph these" links with a querystring still resolve. */}
        <Route path="relationships" element={<Suspense fallback={<Loading />}><RelationshipsPage /></Suspense>} />
        <Route path="claim-graph" element={<Suspense fallback={<Loading />}><ClaimGraphPage /></Suspense>} />
        {AdminPage && (
          <Route path="admin" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} />
        )}
        {MetricsPage && (
          <Route path="admin/metrics" element={<Suspense fallback={<Loading />}><MetricsPage /></Suspense>} />
        )}
      </Route>
    </Routes>
  );
}
