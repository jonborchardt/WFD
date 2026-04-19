// Admin mode detection.
//
// Build-time flag: `VITE_ADMIN=true` in web/.env.development enables
// admin features when running `npm run dev` from web/. Production
// builds leave `VITE_ADMIN` undefined, tree-shaking the admin code
// paths out entirely.
//
// Runtime override (dev only): operators can flip a local build
// between admin and public view without a code change or rebuild, so
// you can test the GitHub-suggest flow on the same localhost you use
// for direct aliases-API edits.
//
//   localStorage["captions.viewMode"] = "public" → force public mode
//   localStorage["captions.viewMode"] = "admin"  → force admin mode
//   (absent)                                       → follow VITE_ADMIN
//
// The helpers below read the override once at module load; flipping
// the toggle triggers a reload so every component picks up the new
// mode.

function readOverride(): "admin" | "public" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage?.getItem("captions.viewMode");
    if (v === "admin" || v === "public") return v;
  } catch {
    // localStorage may throw in sandboxed iframes; fall through.
  }
  return null;
}

function computeIsAdmin(): boolean {
  const built = !!import.meta.env.VITE_ADMIN;
  const override = readOverride();
  if (override === "public") return false;
  if (override === "admin") return built; // can't grant admin in a non-admin build
  return built;
}

export const IS_ADMIN = computeIsAdmin();

// True if the build has VITE_ADMIN set — i.e. admin mode is even an
// option. Used to show/hide the runtime toggle (which is a no-op in
// production).
export const ADMIN_BUILD = !!import.meta.env.VITE_ADMIN;

// Persist the chosen mode and reload so every component recomputes.
export function setViewMode(mode: "admin" | "public" | "default"): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "default") window.localStorage.removeItem("captions.viewMode");
    else window.localStorage.setItem("captions.viewMode", mode);
  } catch {
    return;
  }
  window.location.reload();
}
