// Shared query primitives used by the dev server (server.ts) and the
// static-deploy fetch shim. Plain ES module JS so it can be loaded directly
// in the browser and imported by TypeScript (typed via query.d.ts).

/** @typedef {import("./query.d.ts").CatalogRow} CatalogRow */
/** @typedef {import("./query.d.ts").ListQuery} ListQuery */
/** @typedef {import("./query.d.ts").ListResult} ListResult */
/** @typedef {import("./query.d.ts").EntityIndexEntry} EntityIndexEntry */

export const PER_VIDEO_STAGES = ["fetched", "nlp", "ai", "per-claim"];

export function hasIncompleteStages(row) {
  const stages = row.stages || {};
  for (const name of PER_VIDEO_STAGES) {
    if (!stages[name]) return true;
  }
  return false;
}

export function matchesBase(row, q) {
  if (q.channel && row.channel !== q.channel) return false;
  if (q.status && row.status !== q.status) return false;
  if (q.notStatus && row.status === q.notStatus) return false;
  if (q.incompleteStages && !hasIncompleteStages(row)) return false;
  return true;
}

export function matchesText(row, needleLower) {
  const hay = `${row.title || ""} ${row.videoId} ${row.channel || ""} ${(row.keywords || []).join(" ")} ${row.description || ""}`.toLowerCase();
  return hay.includes(needleLower);
}

export function filterRows(rows, q) {
  const needle = q.text ? q.text.toLowerCase() : "";
  return rows.filter((r) => {
    if (!matchesBase(r, q)) return false;
    if (needle && !matchesText(r, needle)) return false;
    return true;
  });
}

// Adds rows whose entity canonicals match the search term. `entityVideos` is
// { entityId: [{videoId, mentions}] }; `entityIndex` is the flat list with
// canonical names. Mutates `into`.
export function augmentWithEntityMatches(into, allRows, q, entityIndex, entityVideos) {
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

export function sortByPublishDesc(rows) {
  return rows.slice().sort((a, b) => {
    const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
    const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });
}

export function paginate(rows, q) {
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 25));
  const page = Math.max(1, q.page ?? 1);
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, rows: rows.slice(start, start + pageSize) };
}

export function searchEntityIndex(index, { q = "", type = "", limit = 50 }) {
  const needle = q.trim().toLowerCase();
  let out = index;
  if (type) out = out.filter((e) => e.type === type);
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
  return out.slice(0, Math.min(200, Math.max(1, limit)));
}
