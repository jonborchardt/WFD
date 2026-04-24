// Brand marks — inlined as React so they can inherit currentColor
// (TextLogo) and scale cleanly (UfoLogo). The same artwork lives as
// standalone SVG files in web/public/ for og:image / share use.
import { Box, CircularProgress } from "@mui/material";

export function TextLogo({ height = 30 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 608 180"
      height={height}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }}
    >
      <g fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif" fill="currentColor">
        <text x="0" y="80" fontSize="96" fontWeight="900" letterSpacing="-3">WHY FILES</text>
        <g transform="translate(0,158) scale(1.283,1)">
          <text x="0" y="0" fontSize="68" fontWeight="900" letterSpacing="2">DATABASE</text>
        </g>
      </g>
    </svg>
  );
}

export function UfoLogo({ height = 48, withBeam = true }: { height?: number; withBeam?: boolean }) {
  return (
    <svg
      viewBox={withBeam ? "0 0 380 300" : "0 0 240 80"}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id="ufoBeamInline" cx="0.5" cy="0" r="1" fx="0.5" fy="0">
          <stop offset="0" stopColor="#8affc0" stopOpacity="0.65" />
          <stop offset="1" stopColor="#8affc0" stopOpacity="0" />
        </radialGradient>
        <filter id="ufoGlowInline"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <g transform={withBeam ? "translate(190,80)" : "translate(120,45)"}>
        {withBeam && <path d="M-70 30 L-190 200 L190 200 L70 30 Z" fill="url(#ufoBeamInline)" />}
        <ellipse cx="0" cy="25" rx="110" ry="14" fill="#0a0810" />
        <ellipse cx="0" cy="20" rx="100" ry="22" fill="#6a4a90" />
        <ellipse cx="0" cy="14" rx="88" ry="18" fill="#9a7ac0" />
        <ellipse cx="0" cy="5" rx="50" ry="18" fill="#c0a0e8" />
        <ellipse cx="-10" cy="-2" rx="26" ry="8" fill="#e8d8ff" opacity="0.85" />
        <circle cx="-70" cy="22" r="5" fill="#ff5070" />
        <circle cx="-40" cy="26" r="5" fill="#50ff90" />
        <circle cx="-10" cy="28" r="5" fill="#ffd050" />
        <circle cx="20" cy="28" r="5" fill="#50a0ff" />
        <circle cx="50" cy="26" r="5" fill="#ff5070" />
        <circle cx="80" cy="22" r="5" fill="#50ff90" />
        <ellipse cx="-70" cy="22" rx="12" ry="12" fill="#ff5070" opacity="0.35" filter="url(#ufoGlowInline)" />
        <ellipse cx="-40" cy="26" rx="12" ry="12" fill="#50ff90" opacity="0.35" filter="url(#ufoGlowInline)" />
        <ellipse cx="80" cy="22" rx="12" ry="12" fill="#50ff90" opacity="0.35" filter="url(#ufoGlowInline)" />
      </g>
    </svg>
  );
}

// Empty-state scene: big muted UFO + a headline and an optional hint.
// Uses sx on the wrapper so callers can override spacing.
export function EmptyUfo({ message, hint }: { message: string; hint?: string }) {
  return (
    <Box sx={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 1.5, py: 6, px: 2, textAlign: "center",
      color: "text.secondary",
      // Slight desaturation so the UFO reads as "off" in empty states.
      "& svg": { opacity: 0.6, filter: "saturate(0.75)" },
    }}>
      <UfoLogo height={140} />
      <Box sx={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{message}</Box>
      {hint && <Box sx={{ fontSize: 13, opacity: 0.8, maxWidth: 420 }}>{hint}</Box>}
    </Box>
  );
}

// Tiny saucer perched above a tractor-beam. On parent hover the saucer
// rises further up the beam (the beam stays grounded). Sized to fit inside
// a medium MUI Fab (48px). Pair with `sx={{ "&:hover .wfd-saucer": ... }}`
// on the Fab — this component registers the classes, the caller owns the
// hover hook-up so one container's :hover can lift the saucer.
export function LiftoffUfo({ saucer = 18, rise = 14 }: { saucer?: number; rise?: number }) {
  return (
    <Box sx={{
      position: "relative",
      width: saucer * (240 / 80) + 4, // saucer-only UfoLogo ratio
      height: saucer + rise + 12,
      pointerEvents: "none",
    }}>
      {/* Beam: static, anchored to bottom */}
      <Box
        className="wfd-beam"
        sx={{
          position: "absolute",
          left: "50%",
          bottom: 0,
          transform: "translateX(-50%)",
          width: saucer * 1.6,
          height: rise + saucer * 0.4,
          clipPath: "polygon(32% 0, 68% 0, 100% 100%, 0 100%)",
          background: "linear-gradient(to bottom, rgba(138,255,192,0.85), rgba(138,255,192,0.05))",
          filter: "blur(0.5px)",
          opacity: 0.65,
          transition: "opacity 220ms ease",
        }}
      />
      {/* Saucer: rises on parent hover */}
      <Box
        className="wfd-saucer"
        sx={{
          position: "absolute",
          left: "50%",
          top: rise,
          transform: "translateX(-50%)",
          transition: "top 260ms cubic-bezier(.2,.7,.2,1)",
        }}
      >
        <UfoLogo height={saucer} withBeam={false} />
      </Box>
    </Box>
  );
}

// Radial UFO loading indicator: saucer sits in the center of an
// indeterminate circular progress ring. Intended for a fixed-position
// corner placement — not a full-width top bar.
export function UfoLoader({ size = 44 }: { size?: number }) {
  const saucerWidth = size * 0.72;
  return (
    <Box
      role="progressbar"
      aria-label="loading"
      sx={{
        position: "relative",
        width: size,
        height: size,
        pointerEvents: "none",
      }}
    >
      <CircularProgress
        size={size}
        thickness={3.5}
        sx={{
          position: "absolute",
          inset: 0,
          color: "#8affc0",
          // MUI's default indeterminate keyframes on the stroke are the
          // "scan" — exactly what we want around the saucer.
        }}
      />
      {/* Saucer, centered, bobs slightly so it doesn't feel frozen */}
      <Box sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& > *": {
          animation: "wfd-ufo-bob 2.4s ease-in-out infinite",
        },
        "@keyframes wfd-ufo-bob": {
          "0%, 100%": { transform: "translateY(0) rotate(-1.5deg)" },
          "50%":      { transform: "translateY(-1.5px) rotate(1.5deg)" },
        },
      }}>
        <Box sx={{ width: saucerWidth }}>
          <UfoLogo height={saucerWidth * (80 / 240)} withBeam={false} />
        </Box>
      </Box>
    </Box>
  );
}
