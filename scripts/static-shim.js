// Static-mode fetch shim for GitHub Pages deploys.
//
// Module script: loaded before client.js, patches window.fetch so /api/* calls
// resolve from the precomputed files under ./data/. Shares its filter/paginate
// logic with the Node dev server via ./query.js, so there's exactly one copy.
//
// Lazy I/O:
//   catalog.json           loaded on first catalog query
//   entity-index.json      loaded on first entities/search or text query
//   entity-videos.json     loaded on first entity detail or text augmentation
//   nlp/<id>.json          per-video, loaded on demand

import {
  filterRows,
  augmentWithEntityMatches,
  sortByPublishDesc,
  paginate,
  searchEntityIndex,
} from "./query.js";

if (window.__STATIC__) {
  const origFetch = window.fetch.bind(window);
  const basePath = new URL(".", document.baseURI).pathname.replace(/\/?$/, "/");
  const dataBase = basePath + "data/";

  let catalogPromise = null;
  let entityIndexPromise = null;
  let entityVideosPromise = null;
  let relationshipsGraphPromise = null;
  const nlpPromises = new Map();
  const transcriptPromises = new Map();

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = origFetch(dataBase + "catalog/catalog.json")
        .then((r) => r.json())
        .then((file) => Object.values(file.rows || {}));
    }
    return catalogPromise;
  }
  function loadEntityIndex() {
    if (!entityIndexPromise) {
      entityIndexPromise = origFetch(dataBase + "nlp/entity-index.json").then((r) => r.json());
    }
    return entityIndexPromise;
  }
  function loadEntityVideos() {
    if (!entityVideosPromise) {
      entityVideosPromise = origFetch(dataBase + "nlp/entity-videos.json").then((r) => r.json());
    }
    return entityVideosPromise;
  }
  function loadVideoNlp(videoId) {
    let p = nlpPromises.get(videoId);
    if (!p) {
      p = origFetch(dataBase + "nlp/" + videoId + ".json")
        .then((r) => (r.ok ? r.json() : { entities: [], relationships: [] }))
        .catch(() => ({ entities: [], relationships: [] }));
      nlpPromises.set(videoId, p);
    }
    return p;
  }
  function loadTranscript(videoId) {
    let p = transcriptPromises.get(videoId);
    if (!p) {
      p = origFetch(dataBase + "transcripts/" + videoId + ".json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      transcriptPromises.set(videoId, p);
    }
    return p;
  }

  function json(body) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function parseQuery(u) {
    const p = u.searchParams;
    const q = {};
    const text = p.get("text");
    if (text) q.text = text;
    const channel = p.get("channel");
    if (channel) q.channel = channel;
    const status = p.get("status");
    if (status) q.status = status;
    const notStatus = p.get("notStatus");
    if (notStatus) q.notStatus = notStatus;
    const page = p.get("page");
    if (page) q.page = Number(page);
    const pageSize = p.get("pageSize");
    if (pageSize) q.pageSize = Number(pageSize);
    return q;
  }

  async function handleCatalog(u) {
    const q = parseQuery(u);
    const rows = await loadCatalog();
    const filtered = filterRows(rows, q);
    if (q.text) {
      const [index, videos] = await Promise.all([loadEntityIndex(), loadEntityVideos()]);
      augmentWithEntityMatches(filtered, rows, q, index, videos);
    }
    return json(paginate(sortByPublishDesc(filtered), q));
  }

  async function handleEntitiesSearch(u) {
    const index = await loadEntityIndex();
    const results = searchEntityIndex(index, {
      q: u.searchParams.get("q") || "",
      type: u.searchParams.get("type") || "",
      limit: Number(u.searchParams.get("limit") || 50),
    });
    return json({ total: results.length, results });
  }

  async function handleVideo(videoId) {
    const [rows, transcript] = await Promise.all([loadCatalog(), loadTranscript(videoId)]);
    const row = rows.find((r) => r.videoId === videoId);
    if (!row) return json({ error: "not found" });
    return json({ row, transcript: transcript || null });
  }

  async function handleVideoNlp(videoId) {
    const nlp = await loadVideoNlp(videoId);
    return json(nlp);
  }

  async function handleEntity(entityId) {
    const [rows, index, entityVideos] = await Promise.all([
      loadCatalog(),
      loadEntityIndex(),
      loadEntityVideos(),
    ]);
    const idx = index.find((e) => e.id === entityId);
    const entity = idx
      ? { id: idx.id, type: idx.type, canonical: idx.canonical, aliases: [], mentions: [] }
      : null;
    const rowById = new Map(rows.map((r) => [r.videoId, r]));
    const refs = entityVideos[entityId] || [];
    const videos = refs
      .map((ref) => {
        const row = rowById.get(ref.videoId);
        if (!row) return null;
        return {
          videoId: row.videoId,
          title: row.title,
          channel: row.channel,
          publishDate: row.publishDate,
          thumbnailUrl: row.thumbnailUrl,
          mentions: ref.mentions,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ta = a.publishDate ? Date.parse(a.publishDate) : NaN;
        const tb = b.publishDate ? Date.parse(b.publishDate) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
    return json({ entityId, entity, videos });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url;
    if (!url || typeof url !== "string" || !url.startsWith("/api/")) {
      return origFetch(input, init);
    }
    const u = new URL(url, location.origin);
    const path = u.pathname;
    try {
      if (path === "/api/catalog") return await handleCatalog(u);
      if (path === "/api/nlp/entity-index") return json(await loadEntityIndex());
      if (path === "/api/nlp/entity-videos") return json(await loadEntityVideos());
      if (path === "/api/entities/search") return await handleEntitiesSearch(u);
      if (path === "/api/relationships") {
        if (!relationshipsGraphPromise) {
          relationshipsGraphPromise = origFetch(dataBase + "nlp/relationships-graph.json")
            .then((r) => (r.ok ? r.json() : { nodes: [], edges: [] }))
            .catch(() => ({ nodes: [], edges: [] }));
        }
        return json(await relationshipsGraphPromise);
      }
      let m = path.match(/^\/api\/video\/([A-Za-z0-9_-]+)\/nlp$/);
      if (m) return await handleVideoNlp(m[1]);
      m = path.match(/^\/api\/video\/([A-Za-z0-9_-]+)$/);
      if (m) return await handleVideo(m[1]);
      if (path.startsWith("/api/entity/")) {
        const id = decodeURIComponent(path.slice("/api/entity/".length));
        return await handleEntity(id);
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
}
