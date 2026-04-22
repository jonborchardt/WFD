// Admin metrics dashboard (Plan 05). Hits /api/metrics for a live
// snapshot + gate report. Grid of big numbers grouped by section,
// colored by regression status, with baseline + delta when available.

import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box, Chip, Stack, Typography, Link as MuiLink,
} from "@mui/material";
import { colors } from "../theme";

// --- inline types (shaped by src/metrics/*) --------------------------

type MetricUnit = "count" | "pct" | "chars" | "seconds" | "bool";
type GateStatus = "ok" | "regressed" | "improved" | "new" | "missing";

interface Metric {
  name: string;
  value: number | null;
  unit?: MetricUnit;
  description?: string;
  section: string;
  source?: string;
}

interface MetricTarget { name: string; min?: number; max?: number; unit?: MetricUnit; note?: string; }

interface GateRow {
  name: string;
  current: number | null;
  baseline: number | null;
  target?: MetricTarget;
  status: GateStatus;
  reason?: string;
}

interface ApiResponse {
  snapshot: { generatedAt: string; metrics: Metric[] };
  gate: { ok: boolean; rows: GateRow[]; regressions: GateRow[]; checkedAt: string };
}

function fmt(v: number | null | undefined, unit?: MetricUnit): string {
  if (v === null || v === undefined) return "—";
  const n = Number.isInteger(v) ? v.toString() : v.toFixed(2);
  if (unit === "pct") return `${n}%`;
  if (unit === "chars") return `${n}`;
  return n;
}

function statusColor(status: GateStatus): string {
  switch (status) {
    case "regressed": return colors.surface.errorBanner;
    case "improved": return colors.surface.successBanner;
    case "missing": return colors.surface.errorBanner;
    case "new": return colors.surface.raised;
    default: return colors.surface.raised;
  }
}

export function MetricsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/metrics").then(async (r) => {
      if (!r.ok) {
        setErr(`metrics api returned ${r.status}`);
        return;
      }
      setData(await r.json());
    }).catch((e) => setErr(String(e)));
  }, []);

  const bySec = useMemo(() => {
    if (!data) return new Map<string, Metric[]>();
    const m = new Map<string, Metric[]>();
    for (const x of data.snapshot.metrics) {
      if (!m.has(x.section)) m.set(x.section, []);
      m.get(x.section)!.push(x);
    }
    return m;
  }, [data]);

  const gateByName = useMemo(() => {
    if (!data) return new Map<string, GateRow>();
    return new Map(data.gate.rows.map((r) => [r.name, r] as const));
  }, [data]);

  if (err) return <Box sx={{ p: 2 }}><Typography color="error">{err}</Typography></Box>;
  if (!data) return <Box sx={{ p: 2 }}><Typography>loading…</Typography></Box>;

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="baseline" spacing={2} sx={{ mb: 1 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Metrics
        </Typography>
        <Chip
          size="small"
          label={data.gate.ok ? "gate: ok" : `gate: ${data.gate.regressions.length} regression(s)`}
          sx={{
            bgcolor: data.gate.ok ? colors.surface.successBanner : colors.surface.errorBanner,
            color: colors.surface.textOnColor,
            fontWeight: 600,
          }}
        />
        <Typography variant="caption" sx={{ color: colors.surface.textMuted }}>
          as of {data.snapshot.generatedAt.replace("T", " ").slice(0, 19)} UTC
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: colors.surface.textMuted, mb: 3, maxWidth: 760 }}>
        Live corpus-quality signals — entity hygiene, resolution, claims,
        contradictions, operator corrections. Run{" "}
        <code>npm run metrics:baseline</code> to snapshot; <code>npm run metrics:check</code>{" "}
        to gate. <MuiLink component={RouterLink} to="/admin">back to admin</MuiLink>
      </Typography>

      {[...bySec.entries()].map(([section, rows]) => (
        <Box key={section} sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, textTransform: "capitalize" }}>
            {section.replace(/-/g, " ")}
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: 1.5,
            }}
          >
            {rows.map((m) => {
              const g = gateByName.get(m.name);
              const st = g?.status ?? "ok";
              const bg = statusColor(st);
              return (
                <Box
                  key={m.name}
                  sx={{
                    p: 1.25,
                    border: `1px solid ${colors.surface.border}`,
                    borderRadius: 1,
                    bgcolor: bg,
                    minHeight: 88,
                  }}
                  title={m.description ?? m.name}
                >
                  <Typography variant="caption" sx={{ color: colors.surface.textMuted, fontWeight: 500 }}>
                    {m.name}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 600, lineHeight: 1.1, mt: 0.25 }}>
                    {fmt(m.value, m.unit)}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "baseline" }}>
                    {g?.baseline !== null && g?.baseline !== undefined && (
                      <Typography variant="caption" sx={{ color: colors.surface.textMuted }}>
                        base {fmt(g.baseline, m.unit)}
                      </Typography>
                    )}
                    {g?.target?.max !== undefined && (
                      <Typography variant="caption" sx={{ color: colors.surface.textMuted }}>
                        ≤ {fmt(g.target.max, g.target.unit ?? m.unit)}
                      </Typography>
                    )}
                    {g?.target?.min !== undefined && (
                      <Typography variant="caption" sx={{ color: colors.surface.textMuted }}>
                        ≥ {fmt(g.target.min, g.target.unit ?? m.unit)}
                      </Typography>
                    )}
                  </Stack>
                  {g?.reason && (
                    <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
                      {g.reason}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
