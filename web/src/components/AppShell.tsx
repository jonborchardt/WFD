import { Outlet, useNavigate } from "react-router-dom";
import { AppBar, Toolbar, Typography, Button } from "@mui/material";
import { IS_ADMIN } from "../lib/admin";

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
          <Button color="inherit" onClick={() => nav("/about")}>about</Button>
          {IS_ADMIN && <Button color="inherit" onClick={() => nav("/admin")}>admin</Button>}
        </Toolbar>
      </AppBar>
      <Outlet />
    </>
  );
}
