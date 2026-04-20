import { Outlet, useNavigate } from "react-router-dom";
import { AppBar, Toolbar, Typography, Button, Chip } from "@mui/material";
import { IS_ADMIN, ADMIN_BUILD, setViewMode } from "../lib/admin";

export function AppShell() {
  const nav = useNavigate();
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
      <Outlet />
    </>
  );
}
