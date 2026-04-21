// Client-side counterfactual propagation over the claim DAG.
//
// Mirrors the server-side algorithm in src/truth/claim-propagation.ts +
// src/truth/claim-counterfactual.ts, trimmed to what the UI needs. Runs
// over ClaimsIndexEntry records (which already carry dependencies +
// confidence + directTruth), so no claim-file fetch is required.
//
// Cost at current corpus scale (~2.3k claims): ~20 ms. Fine for an
// interactive toggle.

import type { ClaimsIndexEntry, DependencyKind } from "../types";

interface InEdge { from: string; kind: DependencyKind; conf: number }

export interface CounterfactualRow {
  id: string;
  text: string;
  videoId: string;
  baseline: number | null;
  counterfactual: number;
  delta: number;
  /** True when the baseline didn't reach this claim but the pin did (or vice versa). */
  appeared?: boolean;
}

export interface CounterfactualResult {
  rows: CounterfactualRow[];
  /** Rows that shifted above DELTA_VISIBLE (included in `rows`). */
  visibleCount: number;
  /** Rows that shifted but only slightly (below DELTA_VISIBLE). */
  smallShiftCount: number;
}

// Any absolute delta at or above this threshold is shown to the user.
// Values smaller than this are counted but not listed — the graph
// responded but the pin's influence is diluted by other anchors.
const DELTA_VISIBLE = 0.005;
// Below this we ignore entirely (floating-point / convergence noise).
const DELTA_NOISE_FLOOR = 0.0005;

export function runCounterfactual(
  claims: ClaimsIndexEntry[],
  pinId: string,
  pinTruth: number,
  opts: { maxIterations?: number; epsilon?: number; neighborWeight?: number } = {},
): CounterfactualResult {
  const baseline = propagate(claims, new Map(), opts);
  const pinned = new Map<string, number>();
  pinned.set(pinId, clamp01(pinTruth));
  const cf = propagate(claims, pinned, opts);

  const rows: CounterfactualRow[] = [];
  let visibleCount = 0;
  let smallShiftCount = 0;
  for (const c of claims) {
    if (c.id === pinId) continue;
    const b = baseline.get(c.id);
    const a = cf.get(c.id);

    // Case 1: pin caused a claim to go from undefined → defined (or
    // vice versa). Always surface as "appeared" with a synthetic delta
    // measured against 0.5 (neutral) so the UI shows something.
    if (a === undefined && b === undefined) continue;
    if ((a === undefined) !== (b === undefined)) {
      const shown = a ?? b!;
      const delta = a !== undefined ? shown - 0.5 : 0.5 - shown;
      rows.push({
        id: c.id,
        text: c.text,
        videoId: c.videoId,
        baseline: b ?? null,
        counterfactual: shown,
        delta,
        appeared: true,
      });
      visibleCount += 1;
      continue;
    }

    // Case 2: both defined — real delta.
    const delta = a! - b!;
    const abs = Math.abs(delta);
    if (abs < DELTA_NOISE_FLOOR) continue;
    if (abs < DELTA_VISIBLE) {
      smallShiftCount += 1;
      continue;
    }
    rows.push({
      id: c.id,
      text: c.text,
      videoId: c.videoId,
      baseline: b ?? null,
      counterfactual: a!,
      delta,
    });
    visibleCount += 1;
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { rows, visibleCount, smallShiftCount };
}

function propagate(
  claims: ClaimsIndexEntry[],
  pinned: Map<string, number>,
  opts: { maxIterations?: number; epsilon?: number; neighborWeight?: number } = {},
): Map<string, number> {
  const epsilon = opts.epsilon ?? 0.001;
  const maxIter = opts.maxIterations ?? 50;
  const neighborWeight = opts.neighborWeight ?? 0.4;

  const inEdges = new Map<string, InEdge[]>();
  const presupposes = new Map<string, string[]>();
  for (const c of claims) {
    for (const d of c.dependencies ?? []) {
      const list = inEdges.get(d.target) ?? [];
      list.push({ from: c.id, kind: d.kind, conf: c.confidence });
      inEdges.set(d.target, list);
      if (d.kind === "presupposes") {
        const pl = presupposes.get(c.id) ?? [];
        pl.push(d.target);
        presupposes.set(c.id, pl);
      }
    }
  }

  const anchor = new Map<string, number>();
  const value = new Map<string, number | undefined>();
  for (const c of claims) {
    const pin = pinned.get(c.id);
    const a = pin !== undefined ? pin : c.directTruth ?? undefined;
    if (a !== undefined && a !== null) anchor.set(c.id, a);
    value.set(c.id, a ?? undefined);
  }

  let maxDelta = Infinity;
  let iter = 0;
  while (iter < maxIter && maxDelta > epsilon) {
    maxDelta = 0;
    iter++;
    for (const c of claims) {
      const incoming = inEdges.get(c.id) ?? [];
      let w = 0, vsum = 0;
      for (const edge of incoming) {
        if (edge.kind === "elaborates" || edge.kind === "presupposes") continue;
        const v = value.get(edge.from);
        if (v === undefined) continue;
        const contrib = edge.kind === "supports" ? v : 1 - v;
        w += edge.conf;
        vsum += edge.conf * contrib;
      }
      const a = anchor.get(c.id);
      let next: number | undefined;
      if (a !== undefined) {
        next = w > 0 ? a * (1 - neighborWeight) + (vsum / w) * neighborWeight : a;
      } else if (w > 0) {
        next = vsum / w;
      } else {
        next = undefined;
      }
      const preps = presupposes.get(c.id);
      if (preps && next !== undefined) {
        for (const t of preps) {
          const tv = value.get(t);
          if (tv !== undefined && tv < next) next = tv;
        }
      }
      if (next !== undefined) {
        const prev = value.get(c.id);
        const d = prev === undefined ? Math.abs(next) : Math.abs(next - prev);
        if (d > maxDelta) maxDelta = d;
        value.set(c.id, next);
      }
    }
  }

  const out = new Map<string, number>();
  for (const c of claims) {
    const v = value.get(c.id);
    if (v !== undefined) out.set(c.id, clamp01(v));
  }
  return out;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
