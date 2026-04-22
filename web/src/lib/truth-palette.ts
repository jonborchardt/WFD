// Truth-domain helpers: continuous ramp interpolation, side picker,
// and the textual label ramp. Color values come from the central
// theme; the math and labels live here.

import { colors } from "../theme";

export const TRUTH_TRUE = colors.truth.yes;
export const TRUTH_FALSE = colors.truth.no;
export const TRUTH_NEUTRAL = colors.truth.neutral;

// Continuous interpolation through the three truth-ramp stops:
// red at 0, neutral gray at 0.5, green at 1.
export function truthColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) return mix(TRUTH_FALSE, TRUTH_NEUTRAL, clamped * 2);
  return mix(TRUTH_NEUTRAL, TRUTH_TRUE, (clamped - 0.5) * 2);
}

// Three-stop discrete version used for truth-colored borders on
// claim/dep cards. Matches the TruthBar fill colors exactly so a
// card's border and its bar agree on "which side" the claim is on.
export function truthSideColor(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t) || t === 0.5) return TRUTH_NEUTRAL;
  return t > 0.5 ? TRUTH_TRUE : TRUTH_FALSE;
}

export function truthLabel(t: number): string {
  if (t >= 0.85) return "very likely true";
  if (t >= 0.65) return "likely true";
  if (t > 0.55) return "leans true";
  if (t >= 0.45) return "uncertain";
  if (t > 0.35) return "leans false";
  if (t > 0.15) return "likely false";
  return "very likely false";
}

function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(s: string): [number, number, number] {
  const h = s.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
