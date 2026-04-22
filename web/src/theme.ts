// Single source of truth for app-wide visual tokens.
//
// Intent: don't fight MUI. Spacing, typography variants, and
// breakpoints come straight from MUI's defaults — components keep
// using `theme.spacing()` (sx={{ p: 1.5 }}) and `<Typography
// variant="caption">`. What MUI does NOT model out of the box is
// the domain-semantic palette this app needs (entity-by-type,
// claim-kind, claim-relation, contradiction stance, truth ramp,
// facet-card accents). All of that lives here, gets attached to
// the MUI palette via module augmentation, and is type-safe inside
// any sx callback: `sx={{ color: t => t.palette.entity.person }}`.
//
// Two layers:
//   1. `ramps` — the raw palette grouped by hue (green, red, blue,
//      orange/amber, purple, teal, brown, pink, neutral, slate).
//      Step numbers are app-local (0 = darkest, higher = lighter)
//      and non-uniform — they reflect only the shades actually in
//      use, not a full Material scale. One hex lives in exactly
//      one ramp slot; tune the ramp, every semantic token that
//      references it follows.
//   2. `colors` — semantic tokens (truth, entity, claimKind, stance,
//      facet, surface, brand). Each is a ramp reference, not a new
//      hex. Two tokens pointing at the same slot (e.g. truth.yes
//      and stance.asserts both → green[50]) are explicit.
//
// For code that runs outside React (graph builders, label
// dictionaries) both objects are exported directly.
//
// Exception: HomePage's mini-illustration SVGs use raw hex literals.
// Those are decorative wireframes, not reused, and inflating the
// palette to capture them isn't worth it. Every other surface
// reads through this file.

import { createTheme } from "@mui/material";

// ── ramps (raw palette grouped by hue) ────────────────────────────
// One absolute lightness scale shared across every ramp: 0 = pure
// black, 1000 = pure white. Each swatch's slot is its perceived
// luminance (Rec. 601: 0.299·R + 0.587·G + 0.114·B) snapped to the
// nearest 50-multiple, with ±50 bumps to break ties. Perceived
// luminance — not HSL lightness — because the green channel pulls
// far more visual weight than the blue channel; HSL misranks
// across hues (a deep purple looks darker than a saturated magenta
// even when their (max+min)/2 is the same). Slots 0 and 1000 are
// reserved for the true extremes — only `neutral[0]` (#000000)
// claims an endpoint. Every other ramp floats in the middle,
// leaving deliberate headroom both above and below for darker or
// lighter shades to be added later without renumbering.

export const ramps = {
  green: {
    250: "#1b5e20", 350: "#2e7d32", 400: "#388e3c", 500: "#689f38",
    600: "#66bb6a", 700: "#9ccc65", 750: "#a5d6a7",
  },
  red: {
    300: "#b71c1c", 350: "#c62828", 400: "#d32f2f", 500: "#ef5350",
  },
  orange: {
    550: "#ef6c00", 600: "#f57c00", 700: "#ffa726", 750: "#ffb74d",
    800: "#ffca28",
  },
  blue: {
    350: "#1565c0", 400: "#1976d2", 450: "#1e88e5", 500: "#2196f3",
    550: "#42a5f5", 650: "#4fc3f7", 750: "#90caf9",
  },
  indigo: {
    300: "#3949ab", 450: "#5c6bc0",
  },
  purple: {
    300: "#5e35b1", 350: "#8e24aa", 400: "#9c27b0", 450: "#7e57c2",
    500: "#ab47bc", 700: "#ce93d8",
  },
  teal: {
    350: "#00838f", 500: "#26a69a", 600: "#26c6da", 750: "#80deea",
  },
  // True cyan — used for entity.thing. Distinct from teal (greener
  // and more muted) and from blue (less indigo, more aqua).
  cyan: {
    550: "#00bcd4", 650: "#4dd0e1",
  },
  brown: {
    350: "#6d4c41", 450: "#8d6e63", 550: "#a1887f",
  },
  // Pink isn't in the app's main palette — entity.ideology is the
  // only consumer.
  pink: {
    500: "#ec407a", 550: "#f06292",
  },
  // Cool blue-grey ramp aligned to MUI's Material blueGrey swatch
  // plus true black at slot 0. One canonical neutral scale —
  // surfaces, borders, muted text, and time-family entities all
  // ladder along the same hue. No raw web grays. Slot 1000 is
  // reserved for #ffffff if ever needed.
  neutral: {
    0: "#000000",
    200: "#263238", 250: "#37474f", 350: "#455a64", 400: "#546e7a",
    450: "#607d8b", 550: "#78909c", 600: "#90a4ae", 650: "#9fb3bf",
    750: "#b0bec5", 850: "#cfd8dc", 950: "#eceff1",
  },
} as const;

// ── semantic tokens (every value is a ramp reference) ────────────

export const colors = {
  // Truth ramp — used both as a 3-stop discrete palette (TruthBar
  // cells, card left-borders) and as endpoints for a continuous
  // mix (truthColor() in lib/truth-palette.ts).
  truth: {
    yes: ramps.green[350],
    no: ramps.red[350],
    neutral: ramps.neutral[450],
  },

  // Saturated entity-type palette — used as graph-node backgrounds
  // where a dark text color sits on top. Pair only with surfaces
  // that read on saturated colors (the relationships graph nodes,
  // the relationships side-panel chips).
  entity: {
    person: ramps.blue[550],
    organization: ramps.purple[500],
    location: ramps.green[600],
    event: ramps.orange[700],
    thing: ramps.cyan[550],
    role: ramps.neutral[550],
    quantity: ramps.brown[550],
    work_of_media: ramps.red[500],
    ideology: ramps.pink[550],
    facility: ramps.indigo[450],
    group_or_movement: ramps.purple[450],
    technology: ramps.teal[600],
    nationality_or_ethnicity: ramps.green[700],
    law_or_policy: ramps.orange[800],
    time: ramps.neutral[750],
    time_of_day: ramps.neutral[600],
    date_time: ramps.neutral[750],
    specific_date_time: ramps.neutral[550],
    specific_week: ramps.neutral[750],
    specific_month: ramps.neutral[850],
    year: ramps.neutral[750],
    decade: ramps.neutral[550],
  } as Record<string, string>,

  // Lighter entity palette for outlined chips on dark surfaces. The
  // saturated entity palette burns on a black background; this set
  // is calibrated for dark-mode foreground use.
  entityChip: {
    person: ramps.blue[750],
    organization: ramps.purple[700],
    location: ramps.green[750],
    event: ramps.orange[750],
    thing: ramps.teal[750],
    topic: ramps.teal[750],
    misc: ramps.neutral[750],
  } as Record<string, string>,

  // Claim kind banding — drives the small uppercase "EMPIRICAL" tag
  // on every claim row and detail card.
  claimKind: {
    empirical: ramps.blue[400],
    historical: ramps.brown[350],
    speculative: ramps.purple[350],
    opinion: ramps.orange[550],
    definitional: ramps.teal[350],
  } as Record<string, string>,

  // Edge / dependency colors for the claim graph and DepRow cards.
  // `supports`/`contradicts` deliberately pull toward the truth ramp
  // colors so a green "supports" edge reads consistently with a
  // green truth bar.
  claimRelation: {
    supports: ramps.green[350],
    contradicts: ramps.red[350],
    presupposes: ramps.blue[450],
    elaborates: ramps.neutral[550],
    "shared-evidence": ramps.purple[350],
    contradiction: ramps.orange[550],
  } as Record<string, string>,

  // Contradiction stance bands on the contradictions page — green
  // for asserts, red for denies, amber for uncertain, purple for
  // steelman. Carries the "these two sides hold opposite positions"
  // signal visually.
  stance: {
    asserts: ramps.green[350],
    denies: ramps.red[350],
    uncertain: ramps.orange[600],
    steelman: ramps.purple[300],
  } as Record<string, string>,

  // Decorative header strips on facet cards (the colored left edge
  // and dot on /claims and /contradictions). Not semantic — picked
  // so the facet rail reads as a varied palette instead of a slab
  // of identical cards.
  facet: {
    sort: ramps.orange[750],
    kind: ramps.blue[400],
    hostStance: ramps.teal[500],
    truthSource: ramps.purple[400],
    truthRange: ramps.green[400],
    confidence: ramps.green[500],
    publishDate: ramps.blue[350],
    verdict: ramps.orange[600],
    contradictions: ramps.red[400],
    citedBy: ramps.purple[300],
    cites: ramps.indigo[300],
    video: ramps.neutral[350],
    crossVideo: ramps.teal[500],
    sharedEntities: ramps.green[500],
    similarity: ramps.purple[400],
    accent: ramps.blue[750],
    // Saturated mid-blue used to draw the brush-selection rectangle
    // on histogram facets (NumericRange/DateBrush). Bright enough to
    // read as "you're dragging now" against the dimmer accent bars.
    brushHue: ramps.blue[500],
  },

  // Brand accent — the saturated blue used on the HomePage hero
  // border and overline. Distinct from MUI's dark-mode primary,
  // which is intentionally lighter for body contrast.
  brand: {
    accent: ramps.blue[400],
  },

  // Catch-all neutrals for surfaces drawn outside MUI's Paper/Card
  // (the EntityMenu popover renders through a React portal as a
  // raw div). Values mirror MUI's dark-mode surface ramp.
  surface: {
    base: ramps.neutral[200],
    raised: ramps.neutral[250],
    hover: ramps.neutral[350],
    border: ramps.neutral[400],
    text: ramps.neutral[950],
    textMuted: ramps.neutral[600],
    textOnColor: ramps.neutral[0],
    fallback: ramps.neutral[450],
    successBanner: ramps.green[250],
    errorBanner: ramps.red[300],
    accentLink: ramps.blue[650],
  },
} as const;

// ── accessors (lookups with a sane fallback) ──────────────────────

export function entityNodeColor(type: string): string {
  return colors.entity[type] ?? colors.surface.fallback;
}
export function entityChipColor(type: string): string {
  return colors.entityChip[type] ?? colors.entityChip.misc;
}
export function claimKindColor(kind: string): string {
  return colors.claimKind[kind] ?? colors.surface.fallback;
}
export function claimRelationColor(kind: string): string {
  return colors.claimRelation[kind] ?? colors.surface.fallback;
}

// ── MUI module augmentation ───────────────────────────────────────
// Makes the custom palette keys above type-safe inside any sx
// callback. Without this, `t.palette.entity` would be `any`.

declare module "@mui/material/styles" {
  interface Palette {
    entity: typeof colors.entity;
    entityChip: typeof colors.entityChip;
    claimKind: typeof colors.claimKind;
    claimRelation: typeof colors.claimRelation;
    stance: typeof colors.stance;
    facet: typeof colors.facet;
    truth: typeof colors.truth;
    brand: typeof colors.brand;
    surface: typeof colors.surface;
  }
  interface PaletteOptions {
    entity?: typeof colors.entity;
    entityChip?: typeof colors.entityChip;
    claimKind?: typeof colors.claimKind;
    claimRelation?: typeof colors.claimRelation;
    stance?: typeof colors.stance;
    facet?: typeof colors.facet;
    truth?: typeof colors.truth;
    brand?: typeof colors.brand;
    surface?: typeof colors.surface;
  }
}

export const theme = createTheme({
  palette: {
    mode: "dark",
    entity: colors.entity,
    entityChip: colors.entityChip,
    claimKind: colors.claimKind,
    claimRelation: colors.claimRelation,
    stance: colors.stance,
    facet: colors.facet,
    truth: colors.truth,
    brand: colors.brand,
    surface: colors.surface,
  },
});
