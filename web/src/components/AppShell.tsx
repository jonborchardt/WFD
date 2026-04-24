import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar, Box, Button, Chip, Drawer, Fab, IconButton,
  LinearProgress, List, ListItemButton, ListItemText, Toolbar,
  Zoom, useMediaQuery, useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { IS_ADMIN, ADMIN_BUILD, setViewMode } from "../lib/admin";
import { useLoadingCount } from "../lib/loading";
import { VideoLightboxProvider } from "./VideoLightbox";
import { TextLogo, LiftoffUfo } from "./brand";

export interface NavItem {
  path: string;
  label: string;
  adminOnly?: boolean;
}

// Labels are Title Case — desktop renders through MUI Button's default
// text-transform (uppercased either way), mobile Drawer's ListItemText
// renders them verbatim, so the source needs to be human-readable.
export const NAV_ITEMS: NavItem[] = [
  { path: "/videos",                 label: "Videos" },
  { path: "/claims",                 label: "Claims" },
  { path: "/contradictions",         label: "Contradictions" },
  { path: "/cross-video-agreements", label: "Repeat Claims" },
  { path: "/entity-map",             label: "Entity Map" },
  { path: "/argument-map",           label: "Argument Map" },
  { path: "/about",                  label: "About" },
  { path: "/admin",                  label: "Admin", adminOnly: true },
];

function visibleNavItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || IS_ADMIN);
}

export function AppShell() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("sm"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const loadingCount = useLoadingCount();

  const items = visibleNavItems();
  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  return (
    <VideoLightboxProvider>
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
          {!isWide && (
            <IconButton
              size="small"
              edge="start"
              color="inherit"
              aria-label="open navigation"
              onClick={() => setDrawerOpen(true)}
              sx={{ mr: 1 }}
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          )}
          <Box
            role="img"
            aria-label="Why Files Database"
            onClick={() => nav("/")}
            sx={{
              cursor: "pointer",
              flexGrow: 1,
              display: "flex",
              alignItems: "center",
              color: "text.primary",
              minWidth: 0,
            }}
          >
            <TextLogo height={30} />
          </Box>
          {isWide && (
            <Box
              component="nav"
              aria-label="primary"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.25,
                ml: 1,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {items.map((item) => (
                <Button
                  key={item.path}
                  size="small"
                  color="inherit"
                  onClick={() => nav(item.path)}
                  sx={{
                    // Keep the Title Case source rather than MUI's
                    // default all-caps — caps on 2-word items like
                    // "ENTITY GRAPH" eat horizontal space and shout.
                    textTransform: "none",
                    // Prevent wrapping inside a button (what caused
                    // "ENTITY" + "GRAPH" to stack on two lines on
                    // narrow desktop widths).
                    whiteSpace: "nowrap",
                    px: 1.25,
                    fontWeight: isActive(item.path) ? 600 : 400,
                    // Subtle active-item underline so the 600-weight
                    // difference reads at small sizes too.
                    borderBottom: isActive(item.path) ? 2 : 0,
                    borderBottomColor: "primary.main",
                    borderRadius: isActive(item.path) ? 0 : undefined,
                    mb: isActive(item.path) ? "-2px" : 0,
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          )}
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
      <Drawer
        anchor="left"
        open={drawerOpen && !isWide}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
      >
        <Box
          sx={{ width: 260 }}
          role="navigation"
          onClick={() => setDrawerOpen(false)}
        >
          <List>
            {items.map((item) => (
              <ListItemButton
                key={item.path}
                selected={isActive(item.path)}
                onClick={() => nav(item.path)}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>
      <Box sx={{ height: 3, position: "relative" }}>
        {loadingCount > 0 && <LinearProgress sx={{ position: "absolute", inset: 0 }} />}
      </Box>
      <Outlet />
      <ScrollToTopFab />
    </VideoLightboxProvider>
  );
}

// Floating action button that appears once the viewport has scrolled
// past ~400px. Click → smooth-scroll to top. Sits bottom-right so it
// doesn't collide with page-level action bars (e.g. the facet rail's
// "graph these" button lives in the results header, not fixed).
function ScrollToTopFab() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const check = () => setVisible(window.scrollY > 400);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  const onClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <Zoom in={visible} unmountOnExit>
      <Fab
        size="medium"
        color="primary"
        aria-label="scroll to top"
        onClick={onClick}
        sx={{
          position: "fixed",
          right: { xs: 16, sm: 24 },
          bottom: { xs: 16, sm: 24 },
          // Below the sticky app bar but above page content.
          zIndex: (t) => t.zIndex.appBar - 1,
          opacity: 0.92,
          overflow: "visible",
          "&:hover": { opacity: 1 },
          "&:hover .wfd-saucer": { top: 0 },
          "&:hover .wfd-beam":   { opacity: 0.9 },
        }}
      >
        <LiftoffUfo saucer={14} rise={16} />
      </Fab>
    </Zoom>
  );
}
