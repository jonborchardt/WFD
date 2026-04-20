// Shared color ramp for truth values. 0 = red, 0.5 = neutral gray,
// 1 = green. Consumers: the TruthBar component, the relationships
// graph edge overlay, the contradictions page.

export function truthColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    // red (#d32f2f) → gray (#9e9e9e)
    return mix("#d32f2f", "#9e9e9e", clamped * 2);
  }
  // gray (#9e9e9e) → green (#2e7d32)
  return mix("#9e9e9e", "#2e7d32", (clamped - 0.5) * 2);
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
  const ca = hex(a);
  const cb = hex(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hex(s: string): [number, number, number] {
  const h = s.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
