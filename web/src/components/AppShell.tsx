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
      <AppBar position="static" color="default">
        <Toolbar>
          <Typography
            variant="h6"
            sx={{ cursor: "pointer", flexGrow: 1 }}
            onClick={() => nav("/")}
          >
            Why Files Database
          </Typography>
          <Button color="inherit" onClick={() => nav("/")}>home</Button>
          <Button color="inherit" onClick={() => nav("/facets")}>facets</Button>
          <Button color="inherit" onClick={() => nav("/relationships")}>relationships</Button>
          <Button color="inherit" onClick={() => nav("/claims")}>claims</Button>
          <Button color="inherit" onClick={() => nav("/claim-graph")}>claim graph</Button>
          <Button color="inherit" onClick={() => nav("/contradictions")}>contradictions</Button>
          <Button color="inherit" onClick={() => nav("/about")}>about</Button>
          {IS_ADMIN && <Button color="inherit" onClick={() => nav("/admin")}>admin</Button>}
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
