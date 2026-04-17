// Port of src/ui/query.js — pure filter/sort/paginate logic.

import type { VideoRow, EntityIndexEntry, EntityVideosIndex } from "../types";

export interface ListQuery {
  channel?: string;
  status?: string;
  notStatus?: string;
  incompleteStages?: boolean;
  text?: string;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  total: number;
  page: number;
  pageSize: number;
  rows: VideoRow[];
}

function matchesBase(row: VideoRow, q: ListQuery): boolean {
  if (q.channel && row.channel !== q.channel) return false;
  if (q.status && row.status !== q.status) return false;
  if (q.notStatus && row.status === q.notStatus) return false;
  return true;
}

function matchesText(row: VideoRow, needleLower: string): boolean {
  const hay = `${row.title || ""} ${row.videoId} ${row.channel || ""} ${(row.keywords || []).join(" ")} ${row.description || ""}`.toLowerCase();
  return hay.includes(needleLower);
}

export function filterRows(rows: VideoRow[], q: ListQuery): VideoRow[] {
  const needle = q.text ? q.text.toLowerCase() : "";
  return rows.filter((r) => {
    if (!matchesBase(r, q)) return false;
    if (needle && !matchesText(r, needle)) return false;
    return true;
  });
}

export function augmentWithEntityMatches(
  into: VideoRow[],
  allRows: VideoRow[],
  q: ListQuery,
  entityIndex: EntityIndexEntry[],
  entityVideos: EntityVideosIndex,
): VideoRow[] {
  if (!q.text) return into;
  const needle = q.text.toLowerCase();
  const have = new Set(into.map((r) => r.videoId));
  const rowById = new Map(allRows.map((r) => [r.videoId, r]));
  for (const e of entityIndex) {
    if (!e.canonical.toLowerCase().includes(needle)) continue;
    const list = entityVideos[e.id] || [];
    for (const ref of list) {
      if (have.has(ref.videoId)) continue;
      const row = rowById.get(ref.videoId);
      if (!row) continue;
      if (row.status !== "fetched") continue;
      if (!matchesBase(row, q)) continue;
      into.push(row);
      have.add(ref.videoId);
    }
  }
  return into;
}

export function sortByPublishDesc(rows: VideoRow[]): VideoRow[] {
  return rows.slice().sort((a, b) => {
    const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
    const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });
}

export function paginate(rows: VideoRow[], q: ListQuery): ListResult {
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, rows: rows.slice(start, start + pageSize) };
}

export function searchEntityIndex(
  index: EntityIndexEntry[],
  opts: { q?: string; type?: string; limit?: number },
): EntityIndexEntry[] {
  const needle = (opts.q || "").trim().toLowerCase();
  let out = index;
  if (opts.type) out = out.filter((e) => e.type === opts.type);
  if (needle) out = out.filter((e) => e.canonical.toLowerCase().includes(needle));
  out = out.slice().sort((a, b) => {
    if (needle) {
      const ai = a.canonical.toLowerCase().indexOf(needle);
      const bi = b.canonical.toLowerCase().indexOf(needle);
      if (ai !== bi) return ai - bi;
    }
    if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
    return a.canonical.localeCompare(b.canonical);
  });
  return out.slice(0, Math.min(200, Math.max(1, opts.limit || 50)));
}
