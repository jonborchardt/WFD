// Truth-over-time timeline for the video detail page.
//
// One point per evidence quote attached to a claim. X = seconds into
// the video, Y = derived truth remapped from [0,1] to [-1,1] (positive
// = true / green, negative = false / red). The chart trusts the
// derived/direct truth value and does NOT override it based on
// hostStance — propagation already accounts for the host denying a
// claim, so flipping the sign here would double-count the verdict.
//
// Three lines are drawn:
//   • upper dashed — value + halfBand   (top of confidence envelope)
//   • lower dashed — value − halfBand   (bottom of confidence envelope)
//   • solid middle — derived truth, with a clickable dot per evidence
//
// halfBand = √(1 − confidence). The square-root mapping is deliberate:
// in this corpus most claims have confidence in [0.85, 0.95], so a
// linear (1 − conf) × 0.5 mapping collapses the band to a near-flat
// line. sqrt(1 − conf) gives ±0.22 at conf=0.95 and ±0.71 at conf=0.5
// — visibly different. Output is clamped to [−1, +1].
//
// Hover → tooltip with claim text. Click → smooth-scrolls to the
// matching `claim-<id>` anchor in the Claims section and pulses an
// outline so the user can see which row was hit.

import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  Line,
} from "recharts";
import { Box, Paper, Typography, useTheme } from "@mui/material";
import { useMemo } from "react";
import { colors } from "../theme";
import type { ClaimsIndexEntry, PersistedClaims } from "../types";

// ── data ─────────────────────────────────────────────────────────

interface TimelinePoint {
  claimId: string;
  claimText: string;
  time: number;        // seconds into video
  value: number;       // truth remapped to -1..1; 0 when uncalibrated
  bandLow: number;     // value − halfBand, clamped to ≥ -1
  bandHigh: number;    // value + halfBand, clamped to ≤ +1
  confidence: number;  // 0..1
  faded: boolean;      // uncalibrated (no derived truth, no directTruth)
  hostStance: string | null;
}

function buildPoints(
  claims: PersistedClaims,
  index?: ClaimsIndexEntry[],
): TimelinePoint[] {
  const idx = new Map<string, ClaimsIndexEntry>();
  for (const e of index ?? []) idx.set(e.id, e);

  const points: TimelinePoint[] = [];
  for (const c of claims.claims) {
    const entry = idx.get(c.id);
    const truth = entry?.derivedTruth ?? c.directTruth ?? null;
    const conf = clamp01(c.confidence ?? 1);
    const hostStance = c.hostStance ?? null;
    const calibrated = truth != null;

    let value = 0;
    if (calibrated) {
      value = 2 * (truth as number) - 1;
    }

    const halfBand = Math.sqrt(Math.max(0, 1 - conf));
    const bandLow = Math.max(-1, value - halfBand);
    const bandHigh = Math.min(1, value + halfBand);

    for (const ev of c.evidence) {
      if (!isFinite(ev.timeStart)) continue;
      points.push({
        claimId: c.id,
        claimText: c.text,
        time: ev.timeStart,
        value,
        bandLow,
        bandHigh,
        confidence: conf,
        faded: !calibrated,
        hostStance,
      });
    }
  }
  points.sort((a, b) => a.time - b.time);
  return points;
}

// ── helpers ──────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function scrollToClaim(claimId: string) {
  const el = document.getElementById(`claim-${claimId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const prev = el.style.boxShadow;
  el.style.transition = "box-shadow 250ms ease";
  el.style.boxShadow = `0 0 0 2px ${colors.surface.accentLink}`;
  window.setTimeout(() => { el.style.boxShadow = prev; }, 1400);
}

function colorFor(p: TimelinePoint): string {
  if (p.value === 0) return colors.truth.neutral;
  return p.value > 0 ? colors.truth.yes : colors.truth.no;
}

function xDomain(points: TimelinePoint[], lengthSeconds?: number): [number, number] {
  if (lengthSeconds && lengthSeconds > 0) return [0, lengthSeconds];
  if (!points.length) return [0, 60];
  const max = Math.max(...points.map((p) => p.time));
  return [0, Math.max(60, max * 1.02)];
}

// ── tooltip ──────────────────────────────────────────────────────

function TimelineTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimelinePoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <Paper
      elevation={4}
      sx={{
        p: 1,
        // shrink on narrow viewports so the tip doesn't overflow the
        // chart container on mobile (a 360 px screen can't hold 340 px
        // of tooltip plus the chart margin).
        maxWidth: { xs: 240, sm: 340 },
        fontSize: 12,
        // pointerEvents:none keeps the chart hover from being snagged
        // by the tooltip itself, which would otherwise fight scrubbing.
        pointerEvents: "none",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        {fmtTime(p.time)} · truth {p.value === 0 ? "—" : p.value.toFixed(2)} · conf {p.confidence.toFixed(2)}
        {p.hostStance && p.hostStance !== "asserts" ? ` · ${p.hostStance}` : ""}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          lineHeight: 1.35,
          // clamp to four lines so a long claim doesn't push the tip off-screen
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {p.claimText}
      </Typography>
    </Paper>
  );
}

// ── chart ────────────────────────────────────────────────────────

const CHART_HEIGHT = 150;
const CHART_MARGIN = { top: 10, right: 16, bottom: 22, left: 8 };

interface Props {
  claims: PersistedClaims | null;
  indexEntries?: ClaimsIndexEntry[];
  lengthSeconds?: number;
  // When false, the "Story arc" heading + tagline above the chart are
  // suppressed. Useful when the chart is embedded in a context that
  // already labels itself (e.g. the home-page walk-through step).
  showHeading?: boolean;
  // When false, the dots are not clickable (no cursor, no scroll, no
  // tap target). Use for decorative/demo charts where the claim
  // anchors don't exist on the same page.
  interactive?: boolean;
}

export function TruthTimeline({
  claims,
  indexEntries,
  lengthSeconds,
  showHeading = true,
  interactive = true,
}: Props) {
  const theme = useTheme();
  const points = useMemo(
    () => (claims ? buildPoints(claims, indexEntries) : []),
    [claims, indexEntries],
  );
  const domain = useMemo(() => xDomain(points, lengthSeconds), [points, lengthSeconds]);

  if (!claims || points.length === 0) return null;

  // Each rendered dot needs a stroke-color that matches the surface
  // it sits on so its outline reads as "lifted off the chart". The
  // chart is inside a Paper, so use the MUI palette's paper bg.
  const paperBg = theme.palette.background.paper;

  return (
    <Box
      id="video-truth-timeline"
      sx={{
        mt: 3,
        scrollMarginTop: "80px",
        // prevents iOS double-tap-to-zoom from eating taps on dots
        touchAction: "manipulation",
      }}
      aria-label="story arc — truth across the video"
    >
      {showHeading && (
        <Typography variant="h6" sx={{ mb: 1 }}>
          Story arc{" "}
          <Typography component="span" variant="caption" color="text.secondary">
            Each dot is something the host said — click one to read it.
          </Typography>
        </Typography>
      )}

      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={points} margin={CHART_MARGIN}>
          <XAxis
            type="number"
            dataKey="time"
            domain={domain}
            tickFormatter={fmtTime}
            tick={{ fontSize: 11 }}
            stroke={colors.surface.textMuted}
          />
          <YAxis
            type="number"
            domain={[-1, 1]}
            ticks={[-1, 0, 1]}
            tickFormatter={(v: number) => (v === 0 ? "0" : v > 0 ? "true" : "false")}
            tick={{ fontSize: 10, fill: colors.surface.textMuted }}
            width={36}
            stroke={colors.surface.textMuted}
          />
          <ReferenceLine y={0} stroke={colors.surface.border} />
          <Tooltip content={<TimelineTooltip />} cursor={{ stroke: colors.surface.border }} />

          {/* upper / lower confidence bounds */}
          <Line
            type="monotone"
            dataKey="bandHigh"
            stroke={colors.surface.textMuted}
            strokeOpacity={0.6}
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="bandLow"
            stroke={colors.surface.textMuted}
            strokeOpacity={0.6}
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />

          {/* truth line + clickable dots */}
          <Line
            type="monotone"
            dataKey="value"
            stroke={colors.surface.text}
            strokeOpacity={0.85}
            strokeWidth={1.6}
            dot={(props: any) => {
              const p: TimelinePoint = props.payload;
              const cx = props.cx;
              const cy = props.cy;
              if (typeof cx !== "number" || typeof cy !== "number") return <g key={`d${props.index}`} />;
              const r = 2 + 3.5 * p.confidence;
              if (!interactive) {
                return (
                  <circle
                    key={`${p.claimId}-${props.index}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={colorFor(p)}
                    fillOpacity={p.faded ? 0.4 : 0.95}
                    stroke={paperBg}
                    strokeWidth={1.25}
                  />
                );
              }
              // ≥11px hit-radius (22px tap target) so touch users can
              // reliably hit a dot whose visual radius is only 2–5px.
              const hitR = Math.max(r + 6, 11);
              return (
                <g
                  key={`${p.claimId}-${props.index}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => scrollToClaim(p.claimId)}
                >
                  <circle cx={cx} cy={cy} r={hitR} fill="transparent" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={colorFor(p)}
                    fillOpacity={p.faded ? 0.4 : 0.95}
                    stroke={paperBg}
                    strokeWidth={1.25}
                    pointerEvents="none"
                  />
                </g>
              );
            }}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}
