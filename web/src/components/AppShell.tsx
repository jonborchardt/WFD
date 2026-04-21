import { Outlet, useNavigate } from "react-router-dom";
import { AppBar, LinearProgress, Toolbar, Typography, Button, Chip, Box } from "@mui/material";
import { IS_ADMIN, ADMIN_BUILD, setViewMode } from "../lib/admin";
import { useLoadingCount } from "../lib/loading";

export function AppShell() {
  const nav = useNavigate();
  // Progress bar is driven by the global loading counter in
  // src/lib/loading.ts. Pages call `beginLoad()`/`trackLoad()` around
  // their fetches; while any count is outstanding we render the bar.
  // This replaces the old fixed-400ms-on-route-change approach which
  // fired *after* page data had already arrived.
  const loadingCount = useLoadingCount();
  return (
    <>
      <AppBar
        position="sticky"
        color="default"
        elevation={1}
        sx={{ top: 0, zIndex: (t) => t.zIndex.appBar }}
      >
        <Toolbar
          variant="dense"
          sx={{
            minHeight: 40,
            maxWidth: 1600,
            width: "100%",
            mx: "auto",
            px: { xs: 1.5, sm: 2 },
          }}
        >
          <Typography
            variant="subtitle1"
            sx={{ cursor: "pointer", flexGrow: 1, fontWeight: 600, lineHeight: 1 }}
            onClick={() => nav("/")}
          >
            {/* Tighten the space between "Why" and "Files" so the
                channel name reads as one unit, not "Why" + "Files
                Database" — the corpus is The Why Files, not some
                "why-files" thing. nbsp glues them; the inner span
                carries a small negative word-spacing. */}
            <Box
              component="span"
              sx={{ whiteSpace: "nowrap", wordSpacing: "-0.2em" }}
            >
              Why{"\u00a0"}Files
            </Box>{" "}
            Database
          </Typography>
          <Button size="small" color="inherit" onClick={() => nav("/")}>home</Button>
          <Button size="small" color="inherit" onClick={() => nav("/videos")}>videos</Button>
          <Button size="small" color="inherit" onClick={() => nav("/claims")}>claims</Button>
          <Button size="small" color="inherit" onClick={() => nav("/contradictions")}>contradictions</Button>
          <Button size="small" color="inherit" onClick={() => nav("/entity-graph")}>entity graph</Button>
          <Button size="small" color="inherit" onClick={() => nav("/argument-map")}>argument map</Button>
          {IS_ADMIN && <Button size="small" color="inherit" onClick={() => nav("/admin")}>admin</Button>}
          {ADMIN_BUILD && (
            <Chip
              size="small"
              label={IS_ADMIN ? "admin · switch to public" : "public · switch to admin"}
              onClick={() => setViewMode(IS_ADMIN ? "public" : "admin")}
              sx={{ ml: 1, cursor: "pointer" }}
              color={IS_ADMIN ? "primary" : "default"}
              variant="outlined"
            />
          )}
        </Toolbar>
      </AppBar>
      <Box sx={{ height: 3, position: "relative" }}>
        {loadingCount > 0 && <LinearProgress sx={{ position: "absolute", inset: 0 }} />}
      </Box>
      <Outlet />
    </>
  );
}
