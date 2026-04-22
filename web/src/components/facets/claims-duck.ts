// Data bundle + histogram helpers for the faceted /claims and
// /contradictions pages. Lives alongside the home-page duck (which
// loads video × entity data) but loads a different slice:
// claims-index, contradictions, dependency-graph, plus the catalog so
// each claim can resolve to a video title + publish date.

import type {
  ClaimContradiction,
  ClaimsIndexEntry,
  VideoRow,
} from "../../types";
import {
  fetchCatalog,
  fetchClaimsIndex,
  fetchContradictions,
  fetchDependencyGraph,
} from "../../lib/data";

export interface VideoMeta {
  videoId: string;
  title: string;       // full title; falls back to videoId when missing
  shortLabel: string;  // truncated title for facet rows (~34 chars)
  publishMs: number | null;
}

export interface ClaimsBundle {
  claims: ClaimsIndexEntry[];
  claimsById: Map<string, ClaimsIndexEntry>;
  contradictions: ClaimContradiction[];
  contradictionCount: Map<string, number>;
  depCounts: Map<string, { in: number; out: number }>;
  videosById: Map<string, VideoMeta>;
}

let bundlePromise: Promise<ClaimsBundle> | null = null;

export function loadClaimsBundle(): Promise<ClaimsBundle> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    const [idx, cx, dg, catalog] = await Promise.all([
      fetchClaimsIndex(),
      fetchContradictions(),
      fetchDependencyGraph(),
      fetchCatalog(),
    ]);
    const claims = idx?.claims ?? [];
    const claimsById = new Map(claims.map((c) => [c.id, c]));

    const videosById = new Map<string, VideoMeta>();
    for (const row of catalog) {
      videosById.set(row.videoId, metaFromCatalogRow(row));
    }
    // Any claim that references a video missing from the catalog (can
    // happen if catalog files weren't deployed alongside claims) gets
    // a stub so the facet rows still render.
    for (const c of claims) {
      if (!videosById.has(c.videoId)) {
        videosById.set(c.videoId, {
          videoId: c.videoId,
          title: c.videoId,
          shortLabel: c.videoId,
          publishMs: null,
        });
      }
    }

    // Plan 04 §E2 — public UI filters out `verified: null` pending
    // candidates; admin mode keeps them so unverified pairs can be
    // triaged in the admin panel. The pipeline always writes the full
    // list; filtering is a display-time decision.
    const isAdmin = Boolean(import.meta.env.VITE_ADMIN);
    const raw = cx?.contradictions ?? [];
    const contradictions = isAdmin
      ? raw
      : raw.filter((x) => x.verified !== null);
    const contradictionCount = new Map<string, number>();
    for (const c of contradictions) {
      contradictionCount.set(c.left, (contradictionCount.get(c.left) ?? 0) + 1);
      contradictionCount.set(c.right, (contradictionCount.get(c.right) ?? 0) + 1);
    }

    const depCounts = new Map<string, { in: number; out: number }>();
    for (const e of dg?.edges ?? []) {
      const from = depCounts.get(e.from) ?? { in: 0, out: 0 };
      from.out += 1;
      depCounts.set(e.from, from);
      const to = depCounts.get(e.to) ?? { in: 0, out: 0 };
      to.in += 1;
      depCounts.set(e.to, to);
    }

    return {
      claims, claimsById, contradictions,
      contradictionCount, depCounts, videosById,
    };
  })();
  return bundlePromise;
}

export function invalidateClaimsBundle(): void {
  bundlePromise = null;
}

// Titles on this corpus are often 60–90 chars; facet rows have ~180px
// of label width. 34 chars fits comfortably without word-breaking.
const SHORT_LABEL_MAX = 34;

function metaFromCatalogRow(row: VideoRow): VideoMeta {
  const title = (row.title || "").trim();
  const iso = row.publishDate || row.uploadDate;
  const ms = iso ? Date.parse(iso) : NaN;
  return {
    videoId: row.videoId,
    title: title || row.videoId,
    shortLabel: shortenTitle(title || row.videoId),
    publishMs: Number.isFinite(ms) ? ms : null,
  };
}

function shortenTitle(t: string): string {
  const trimmed = t.trim();
  if (trimmed.length <= SHORT_LABEL_MAX) return trimmed;
  return trimmed.slice(0, SHORT_LABEL_MAX - 1).trimEnd() + "…";
}

// Resolve a claim's truth: derived wins over direct, both nullable.
export function truthValue(c: ClaimsIndexEntry): number | null {
  if (c.derivedTruth !== null && c.derivedTruth !== undefined) return c.derivedTruth;
  if (c.directTruth !== null && c.directTruth !== undefined) return c.directTruth;
  return null;
}

// ── histogram binners ─────────────────────────────────────────────

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

// 0..1 with fixed-width bins (default 0.05 → 20 bins). Fixed-width
// rather than quantile so the axis reads as a predictable 0..1 and
// brushes round-trip to sensible min/max values.
export function binUnitInterval(
  values: Array<number | null | undefined>,
  step = 0.05,
): HistogramBin[] {
  const n = Math.round(1 / step);
  const bins: HistogramBin[] = [];
  for (let i = 0; i < n; i++) {
    bins.push({ min: i * step, max: (i + 1) * step, count: 0 });
  }
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (v < 0 || v > 1) continue;
    const idx = Math.min(n - 1, Math.floor(v / step));
    bins[idx].count += 1;
  }
  return bins;
}

// Integer histogram on [0, max]. Used for shared-entity counts.
export function binIntegerCounts(values: number[], max: number): HistogramBin[] {
  const bins: HistogramBin[] = [];
  for (let i = 0; i <= max; i++) {
    bins.push({ min: i, max: i + 1, count: 0 });
  }
  for (const v of values) {
    if (v < 0) continue;
    const idx = Math.min(max, Math.max(0, Math.round(v)));
    bins[idx].count += 1;
  }
  return bins;
}
