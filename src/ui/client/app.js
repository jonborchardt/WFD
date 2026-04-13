// @ts-check
// Browser-side SPA. Loaded by the shell via `<script type="module" src="/client.js">`.
// Kept as plain JS so the browser can run it directly through the importmap —
// no build step, but real syntax highlighting and no template-literal escaping.
//
// Routes handled client-side:
//   /          → catalog list
//   /admin     → catalog + ingest controls
//   /video/:id → transcript detail
//
// Type checking is anchored to ../shared/types.ts and ../catalog/catalog.ts
// via the JSDoc @typedef imports below; VSCode / tsc --checkJs use those to
// validate our use of Row, Entity, Relationship, TranscriptSpan.

/** @typedef {import("../../shared/types.js").Entity} Entity */
/** @typedef {import("../../shared/types.js").Relationship} Relationship */
/** @typedef {import("../../shared/types.js").TranscriptSpan} TranscriptSpan */
/** @typedef {import("../../catalog/catalog.js").CatalogRow} Row */

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import {
  CssBaseline, ThemeProvider, createTheme, AppBar, Toolbar, Typography,
  Container, Paper, Table, TableHead, TableBody, TableRow, TableCell,
  TablePagination, TextField, Select, MenuItem, LinearProgress, Chip, Button, Box, Link, Stack,
  Menu, Checkbox, FormControlLabel, ListItemText, ListItemIcon, Tooltip, Alert, AlertTitle,
} from "@mui/material";

const html = htm.bind(React.createElement);
const theme = createTheme({ palette: { mode: "dark" } });

function useRoute() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const nav = (to) => {
    history.pushState({}, "", to);
    setPath(to);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return [path, nav];
}

function StatusChip({ status }) {
  const color = status === "fetched" ? "success" : status === "pending" ? "default" : "warning";
  return html`<${Chip} size="small" label=${status} color=${color} />`;
}

const fmtDate = (d) => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  return t.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};
const truncate = (s, n) => {
  if (!s) return "";
  const clean = String(s).replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "..." : clean;
};
const descriptionPreview = (s, n) => {
  if (!s) return "";
  const nl = s.indexOf("\n");
  const rest = nl >= 0 ? s.slice(nl + 1) : s;
  return truncate(rest, n);
};

const CATALOG_COLUMNS = [
  { key: "thumbnail", label: "", menuLabel: "Thumbnail", default: true, headSx: { width: 72 }, cellSx: { p: 0.5 },
    render: (r) => r.thumbnailUrl
      ? html`<img src=${r.thumbnailUrl} alt="" width="64" height="64" style=${{ objectFit: "contain", display: "block", borderRadius: 2, background: "transparent" }} />`
      : null },
  { key: "videoId", label: "ID", default: false, render: (r) => r.videoId },
  { key: "title", label: "Title", default: true,
    headSx: { width: 240 }, cellSx: { width: 240 },
    render: (r) => html`<${Link} href=${r.sourceUrl || ("https://www.youtube.com/watch?v=" + r.videoId)} target="_blank" rel="noopener" underline="hover" onClick=${e => e.stopPropagation()}>${r.title || r.videoId}<//>` },
  { key: "channel", label: "Channel", default: false, render: (r) => r.channel || "" },
  { key: "channelId", label: "Channel ID", default: false, render: (r) => r.channelId || "" },
  { key: "description", label: "Description", default: true,
    headSx: { width: 480 },
    cellSx: { width: 480, maxWidth: 480, color: "text.secondary" },
    render: (r) => descriptionPreview(r.description, 100) },
  { key: "publishDate", label: "Published", default: true, render: (r) => fmtDate(r.publishDate) },
  { key: "status", label: "Status", default: true, render: (r) => html`<${StatusChip} status=${r.status} />` },
  { key: "uploadDate", label: "Uploaded", default: false, render: (r) => fmtDate(r.uploadDate) },
  { key: "fetchedAt", label: "Fetched", default: false, render: (r) => fmtDate(r.fetchedAt) },
  { key: "category", label: "Category", default: false, render: (r) => r.category || "" },
  { key: "lengthSeconds", label: "Length", default: false,
    render: (r) => r.lengthSeconds ? `${Math.floor(r.lengthSeconds / 60)}m` : "" },
  { key: "viewCount", label: "Views", default: false,
    render: (r) => r.viewCount ? r.viewCount.toLocaleString() : "" },
  { key: "attempts", label: "Attempts", default: false, render: (r) => r.attempts ?? "" },
  { key: "isLiveContent", label: "Live", default: false, render: (r) => r.isLiveContent ? "yes" : "" },
  { key: "sourceUrl", label: "Source URL", default: false,
    render: (r) => r.sourceUrl
      ? html`<${Link} href=${r.sourceUrl} target="_blank" rel="noopener" underline="hover" onClick=${e => e.stopPropagation()}>${r.sourceUrl}<//>`
      : "" },
  { key: "transcriptPath", label: "Transcript Path", default: false, render: (r) => r.transcriptPath || "" },
  { key: "errorReason", label: "Error", default: false, render: (r) => r.errorReason || "" },
  { key: "lastError", label: "Last Error", default: false,
    cellSx: { maxWidth: 320, color: "text.secondary" },
    render: (r) => r.lastError || "" },
];

function useUnifiedSuggestions(text) {
  const [results, setResults] = useState(null);
  useEffect(() => {
    const q = text.trim();
    if (!q) { setResults(null); return; }
    let cancelled = false;
    const h = setTimeout(() => {
      Promise.all([
        fetch("/api/entities/search?limit=8&q=" + encodeURIComponent(q)).then(r => r.json()).catch(() => ({ results: [] })),
        fetch("/api/catalog?pageSize=6&page=1&text=" + encodeURIComponent(q)).then(r => r.json()).catch(() => ({ rows: [], total: 0 })),
      ]).then(([ent, cat]) => {
        if (cancelled) return;
        setResults({ entities: ent.results || [], videos: cat.rows || [], videoTotal: cat.total || 0 });
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(h); };
  }, [text]);
  return results;
}

function EntitySuggestions({ text, nav, onPick }) {
  const results = useUnifiedSuggestions(text);
  const q = text.trim();
  if (!q || !results) return null;
  const { entities, videos, videoTotal } = results;
  const filterRow = html`
    <${Box}
      sx=${{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderBottom: 1, borderColor: "divider" }}
      onClick=${() => { if (onPick) onPick(); nav("/?search=" + encodeURIComponent(q)); }}
    >
      <${Typography} sx=${{ flexGrow: 1 }}>
        All Videos with "<b>${q}</b>"
      <//>
      <${Typography} variant="caption" color="text.secondary">press enter<//>
    <//>
  `;
  if (entities.length === 0 && videos.length === 0) {
    return html`
      <${Box} sx=${{ borderTop: 1, borderColor: "divider", bgcolor: "background.default" }}>
        ${filterRow}
        <${Box} sx=${{ px: 2, py: 1 }}>
          <${Typography} variant="caption" color="text.secondary">no entities or videos match<//>
        <//>
      <//>
    `;
  }
  return html`
    <${Box} sx=${{ borderTop: 1, borderColor: "divider", bgcolor: "background.default", maxHeight: 420, overflow: "auto" }}>
      ${filterRow}
      ${entities.length > 0 && html`
        <${Typography} variant="caption" color="text.secondary" sx=${{ px: 2, pt: 1, display: "block" }}>
          entities
        <//>
        ${entities.map(r => html`
          <${Box}
            key=${r.id}
            sx=${{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
            onClick=${() => { if (onPick) onPick(); nav("/entity/" + encodeURIComponent(r.id)); }}
          >
            <${Chip} size="small" label=${r.type} color=${ENTITY_TYPE_COLOR[r.type] || "default"} />
            <${Typography} sx=${{ flexGrow: 1 }}>${r.canonical}<//>
            <${Typography} variant="caption" color="text.secondary">
              ${r.mentionCount} mention${r.mentionCount === 1 ? "" : "s"} · ${r.videoCount} video${r.videoCount === 1 ? "" : "s"}
            <//>
          <//>
        `)}
      `}
      ${videos.length > 0 && html`
        <${Typography} variant="caption" color="text.secondary" sx=${{ px: 2, pt: 1, display: "block", borderTop: entities.length > 0 ? 1 : 0, borderColor: "divider", mt: entities.length > 0 ? 0.5 : 0 }}>
          videos (${videoTotal})
        <//>
        ${videos.map(v => html`
          <${Box}
            key=${v.videoId}
            sx=${{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
            onClick=${() => { if (onPick) onPick(); nav("/video/" + v.videoId); }}
          >
            ${v.thumbnailUrl && html`<img src=${v.thumbnailUrl} alt="" width="48" height="27" style=${{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />`}
            <${Box} sx=${{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
              <${Typography} variant="body2" noWrap>${v.title || v.videoId}<//>
              <${Typography} variant="caption" color="text.secondary" noWrap>
                ${[v.channel, fmtDate(v.publishDate)].filter(Boolean).join(" · ")}
              <//>
            <//>
          <//>
        `)}
      `}
    <//>
  `;
}

function CatalogTable({ nav, showStatusFilter, columns, defaultFailedOnly }) {
  const cols = columns || CATALOG_COLUMNS;
  const [data, setData] = useState({ total: 0, page: 1, pageSize: 25, rows: [] });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [text, setText] = useState(() => new URLSearchParams(location.search).get("search") || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [status, setStatus] = useState("");
  const [failedOnly, setFailedOnly] = useState(!!defaultFailedOnly);
  const [visible, setVisible] = useState(() => {
    const init = {};
    for (const c of cols) init[c.key] = c.default;
    return init;
  });
  const [colMenuAnchor, setColMenuAnchor] = useState(null);
  const activeCols = cols.filter(c => visible[c.key]);

  useEffect(() => {
    const on = () => setText(new URLSearchParams(location.search).get("search") || "");
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const current = params.get("search") || "";
    if (current === text) return;
    if (text) params.set("search", text); else params.delete("search");
    const qs = params.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : ""));
  }, [text]);

  useEffect(() => { setPage(1); }, [text, status, failedOnly]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (text) q.set("text", text);
    if (status) q.set("status", status);
    if (failedOnly) q.set("incompleteStages", "1");
    q.set("page", String(page));
    q.set("pageSize", String(pageSize));
    let cancelled = false;
    const delay = text ? 200 : 0;
    const h = setTimeout(() => {
      fetch("/api/catalog?" + q).then(r => r.json()).then(d => { if (!cancelled) setData(d); });
    }, delay);
    return () => { cancelled = true; clearTimeout(h); };
  }, [text, status, failedOnly, page, pageSize]);

  const pagination = html`
    <${TablePagination}
      component="div"
      count=${data.total}
      page=${page - 1}
      onPageChange=${(_, p) => setPage(p + 1)}
      rowsPerPage=${pageSize}
      onRowsPerPageChange=${e => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
      rowsPerPageOptions=${[10, 25, 50, 100]}
    />
  `;

  return html`
    <${Box}>
      <${Paper}>
        <${Box} sx=${{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
          <${TextField}
            size="small"
            placeholder="search"
            value=${text}
            onChange=${e => { setText(e.target.value); setShowDropdown(true); }}
            onFocus=${() => { if (text) setShowDropdown(true); }}
            onKeyDown=${e => { if (e.key === "Enter") { setShowDropdown(false); e.target.blur(); } else if (e.key === "Escape") { setShowDropdown(false); } }}
          />
          ${showStatusFilter && html`
            <${FormControlLabel}
              control=${html`<${Checkbox} size="small" checked=${failedOnly} onChange=${e => setFailedOnly(e.target.checked)} />`}
              label="failed"
            />
          `}
          <${Box} sx=${{ flexGrow: 1 }} />
          <${Typography} variant="caption" sx=${{ mr: 1, color: "text.secondary" }}>
            ${activeCols.length} / ${cols.length} columns
          <//>
          <${Button} size="small" variant="outlined" onClick=${e => setColMenuAnchor(e.currentTarget)}>
            columns ▾
          <//>
          <${Menu}
            anchorEl=${colMenuAnchor}
            open=${Boolean(colMenuAnchor)}
            onClose=${() => setColMenuAnchor(null)}
            anchorOrigin=${{ vertical: "bottom", horizontal: "right" }}
            transformOrigin=${{ vertical: "top", horizontal: "right" }}
            PaperProps=${{ sx: { maxHeight: 400 } }}
          >
            ${cols.map(c => html`
              <${MenuItem} key=${c.key} onClick=${() => setVisible(v => ({ ...v, [c.key]: !v[c.key] }))} dense>
                <${ListItemIcon}><${Checkbox} edge="start" size="small" checked=${!!visible[c.key]} tabIndex=${-1} disableRipple /><//>
                <${ListItemText} primary=${c.menuLabel || c.label} />
              <//>
            `)}
          <//>
        <//>
        ${showDropdown && html`<${EntitySuggestions} text=${text} nav=${nav} onPick=${() => setShowDropdown(false)} />`}
        ${pagination}
        <${Table} size="small">
          <${TableHead}>
            <${TableRow}>
              ${activeCols.map(c => html`<${TableCell} key=${c.key} sx=${c.headSx || c.cellSx || {}}>${c.label}<//>`)}
            <//>
          <//>
          <${TableBody}>
            ${data.rows.map(r => html`
              <${TableRow} key=${r.videoId} hover style=${{ cursor: "pointer" }} onClick=${() => nav("/video/" + r.videoId)}>
                ${activeCols.map(c => html`
                  <${TableCell} key=${c.key} sx=${c.cellSx || {}}>${c.render(r)}<//>
                `)}
              <//>
            `)}
          <//>
        <//>
        ${pagination}
      <//>
    <//>
  `;
}

const HOME_COLUMNS = CATALOG_COLUMNS
  .filter(c => c.key !== "status")
  .map(c => ["lengthSeconds", "viewCount"].includes(c.key) ? { ...c, default: true } : c);

const PIPELINE_STAGES = ["fetched", "nlp", "ai", "per-claim"];

function stageCellFor(stageName) {
  return (r) => {
    const stages = r.stages || {};
    if (stages[stageName]) {
      return html`<${Chip} size="small" color="success" label="pass" />`;
    }
    // Stage hasn't been recorded. If an earlier stage is also missing, this
    // one is simply blocked/pending. If all prior stages passed and the row
    // carries an error, attribute the failure to this stage.
    const idx = PIPELINE_STAGES.indexOf(stageName);
    const priorAllPass = PIPELINE_STAGES.slice(0, idx).every(s => stages[s]);
    const hasError = r.status === "failed-retryable" || r.status === "failed-needs-user" || !!r.lastError;
    if (priorAllPass && hasError) {
      const reason = r.errorReason || r.lastError || "failed";
      return html`<${Tooltip} title=${r.lastError || reason}>
        <${Chip} size="small" color="error" label=${"fail: " + reason} />
      <//>`;
    }
    return html`<${Chip} size="small" variant="outlined" label="pending" />`;
  };
}

const STAGE_COLUMNS = PIPELINE_STAGES.map(s => ({
  key: "stage:" + s,
  label: s,
  default: true,
  render: stageCellFor(s),
}));

const ADMIN_COLUMNS = (() => {
  const hidden = new Set(["status", "errorReason", "lastError", "attempts"]);
  const base = CATALOG_COLUMNS.filter(c => !hidden.has(c.key));
  const idx = base.findIndex(c => c.key === "sourceUrl");
  const ordered = [
    ...base.slice(0, idx + 1),
    ...STAGE_COLUMNS,
    ...base.slice(idx + 1),
  ];
  return ordered.map(c => c.key === "sourceUrl" ? { ...c, default: true } : c);
})();

function CatalogList({ nav }) {
  return html`
    <${Container} maxWidth="lg" sx=${{ py: 3 }}>
      <${Typography} variant="h4" gutterBottom>All Videos<//>
      <${CatalogTable} nav=${nav} columns=${HOME_COLUMNS} />
    <//>
  `;
}

function UpstreamCheck() {
  const [state, setState] = useState({ loading: true, channels: [] });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/upstream-check")
      .then(r => r.json())
      .then(d => { if (!cancelled) setState({ loading: false, channels: d.channels || [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, channels: [] }); });
    return () => { cancelled = true; };
  }, []);
  if (state.loading) return null;
  return html`
    <${Box} sx=${{ mb: 2 }}>
      ${state.channels.map(c => {
        if (c.error) {
          return html`<${Alert} key=${c.channelId} severity="warning" sx=${{ mb: 1 }}>
            ${c.channelLabel}: upstream check failed — ${c.error}
          <//>`;
        }
        if (c.behind && c.upstream) {
          const upDate = fmtDate(c.upstream.publishedAt);
          const catDate = c.catalog?.publishDate ? fmtDate(c.catalog.publishDate) : "none";
          const ytUrl = "https://www.youtube.com/watch?v=" + c.upstream.videoId;
          return html`<${Alert} key=${c.channelId} severity="warning" sx=${{ mb: 1 }}>
            <${AlertTitle}>${c.channelLabel}: new video needs upload<//>
            Upstream latest: <${Link} href=${ytUrl} target="_blank" rel="noopener">${c.upstream.title}<//> (${upDate})
            <${Box} component="span" sx=${{ ml: 1, color: "text.secondary" }}>— catalog latest: ${catDate}<//>
          <//>`;
        }
        if (!c.upstream) {
          return html`<${Alert} key=${c.channelId} severity="info" sx=${{ mb: 1 }}>
            ${c.channelLabel}: no upstream video found
          <//>`;
        }
        return html`<${Alert} key=${c.channelId} severity="success" sx=${{ mb: 1 }}>
          ${c.channelLabel}: up to date (latest ${fmtDate(c.upstream.publishedAt)})
        <//>`;
      })}
    <//>
  `;
}

function AdminPage({ nav }) {
  return html`
    <${Container} maxWidth="lg" sx=${{ py: 3 }}>
      <${Typography} variant="h4" gutterBottom>Admin<//>
      <${UpstreamCheck} />
      <${CatalogTable}
        nav=${nav}
        showStatusFilter=${true}
        defaultFailedOnly=${true}
        columns=${ADMIN_COLUMNS}
      />
    <//>
  `;
}

const ENTITY_TYPE_COLOR = {
  person: "primary",
  organization: "secondary",
  location: "success",
  event: "warning",
  thing: "info",
  time: "default",
};

function NlpPanel({ videoId, nlp, nav }) {
  if (!nlp) return html`<${Typography} variant="body2" color="text.secondary" sx=${{ mt: 2 }}>analyzing transcript…<//>`;
  const entities = nlp.entities || [];
  const relationships = nlp.relationships || [];
  if (entities.length === 0) {
    return html`<${Typography} variant="body2" color="text.secondary" sx=${{ mt: 2 }}>no entities extracted<//>`;
  }
  const byType = {};
  for (const e of entities) (byType[e.type] ||= []).push(e);
  const order = ["person", "organization", "location", "event", "thing", "time"];
  const entById = Object.fromEntries(entities.map(e => [e.id, e]));
  const deepLink = (t) => "https://www.youtube.com/watch?v=" + videoId + "&t=" + Math.floor(t) + "s";
  const fmt = s => {
    const n = Math.floor(s);
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  };
  return html`
    <${Box} sx=${{ mt: 2 }}>
      <${Typography} variant="h6" sx=${{ mb: 1 }}>
        Entities <${Typography} component="span" variant="caption" color="text.secondary">${entities.length} unique · ${entities.reduce((n, e) => n + e.mentions.length, 0)} mentions<//>
      <//>
      ${order.filter(t => byType[t]).map(t => html`
        <${Box} key=${t} sx=${{ mb: 1.5 }}>
          <${Typography} variant="overline" color="text.secondary">${t}<//>
          <${Box} sx=${{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            ${byType[t]
              .slice()
              .sort((a, b) => a.canonical.localeCompare(b.canonical, undefined, { numeric: true, sensitivity: "base" }))
              .map(e => {
                const label = e.canonical + (e.mentions.length > 1 ? " (" + e.mentions.length + ")" : "");
                return html`
                  <${Chip}
                    key=${e.id}
                    size="small"
                    color=${ENTITY_TYPE_COLOR[t] || "default"}
                    variant="outlined"
                    label=${label}
                    clickable
                    onClick=${() => nav("/entity/" + encodeURIComponent(e.id))}
                  />
                `;
              })}
          <//>
        <//>
      `)}
      ${relationships.length > 0 && html`
        <${Typography} variant="h6" sx=${{ mt: 2, mb: 1 }}>
          Relationships <${Typography} component="span" variant="caption" color="text.secondary">${relationships.length}<//>
        <//>
        <${Box} sx=${{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          ${relationships
            .slice()
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 50)
            .map(r => {
              const s = entById[r.subjectId];
              const o = entById[r.objectId];
              if (!s || !o) return null;
              return html`
                <${Box} key=${r.id} sx=${{ display: "flex", alignItems: "center", gap: 1, fontSize: 14 }}>
                  <${Link} href=${deepLink(r.evidence.timeStart)} target="_blank" underline="hover" sx=${{ fontFamily: "monospace", fontSize: 12 }}>
                    [${fmt(r.evidence.timeStart)}]
                  <//>
                  <${Chip} size="small" label=${s.canonical} variant="outlined" color=${ENTITY_TYPE_COLOR[s.type] || "default"} clickable onClick=${() => nav("/entity/" + encodeURIComponent(s.id))} />
                  <${Typography} variant="caption" color="text.secondary">${r.predicate}<//>
                  <${Chip} size="small" label=${o.canonical} variant="outlined" color=${ENTITY_TYPE_COLOR[o.type] || "default"} clickable onClick=${() => nav("/entity/" + encodeURIComponent(o.id))} />
                  <${Typography} variant="caption" color="text.secondary">${r.confidence.toFixed(2)}<//>
                <//>
              `;
            })}
        <//>
      `}
    <//>
  `;
}

function VideoDetail({ videoId, nav }) {
  const [data, setData] = useState(null);
  const [nlp, setNlp] = useState(null);
  useEffect(() => {
    setData(null);
    setNlp(null);
    fetch("/api/video/" + encodeURIComponent(videoId)).then(r => r.json()).then(setData);
    fetch("/api/video/" + encodeURIComponent(videoId) + "/nlp").then(r => r.json()).then(setNlp);
  }, [videoId]);
  if (!data) return html`<${Container} sx=${{ py: 3 }}><${Typography}>loading...<//><//>`;
  if (data.error) return html`<${Container} sx=${{ py: 3 }}><${Typography} color="error">${data.error}<//><//>`;
  const { row, transcript } = data;
  const cues = transcript?.cues || [];
  const fmt = s => {
    const n = Math.floor(s);
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  };
  const metaLine = [
    row.channel,
    fmtDate(row.publishDate || row.uploadDate),
    row.lengthSeconds && `${Math.floor(row.lengthSeconds / 60)}m`,
    row.viewCount && `${row.viewCount.toLocaleString()} views`,
  ].filter(Boolean).join(" · ");
  return html`
    <${Container} maxWidth="md" sx=${{ py: 3 }}>
      <${Button} size="small" onClick=${() => nav("/")}>← back<//>
      <${Box} sx=${{ mt: 2, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        ${row.thumbnailUrl && html`
          <${Link} href=${row.sourceUrl || ("https://www.youtube.com/watch?v=" + row.videoId)} target="_blank" rel="noopener" sx=${{ flexShrink: 0 }}>
            <img src=${row.thumbnailUrl} alt="" style=${{ width: 320, maxWidth: "100%", height: "auto", display: "block", borderRadius: 4 }} />
          <//>
        `}
        <${Box} sx=${{ flex: 1, minWidth: 240 }}>
          <${Typography} variant="h5">${row.title || row.videoId}<//>
          <${Typography} variant="body2" color="text.secondary" sx=${{ mt: 0.5 }}>
            ${metaLine}
          <//>
          ${row.keywords && row.keywords.length > 0 && html`
            <${Box} sx=${{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              ${row.keywords.slice(0, 20).map(k => html`<${Chip} key=${k} size="small" label=${k} variant="outlined" clickable onClick=${() => nav("/?search=" + encodeURIComponent(k))} />`)}
            <//>
          `}
        <//>
      <//>
      ${row.description && html`
        <${Typography} variant="body2" sx=${{ mt: 2, whiteSpace: "pre-wrap" }}>${row.description.slice(0, 1000)}<//>
      `}
      ${!transcript && html`<${Typography} sx=${{ mt: 2 }}>no transcript on disk<//>`}
      ${transcript && html`<${NlpPanel} videoId=${row.videoId} nlp=${nlp} nav=${nav} />`}
      ${transcript && html`
        <${Paper} sx=${{ mt: 2, p: 2, maxHeight: "70vh", overflow: "auto" }}>
          ${cues.map((c, i) => html`
            <${Box} key=${i} sx=${{ py: 0.5 }}>
              <${Link} href=${"https://www.youtube.com/watch?v=" + row.videoId + "&t=" + Math.floor(c.start) + "s"} target="_blank" underline="hover">
                [${fmt(c.start)}]
              <//>
              ${" " + c.text}
            <//>
          `)}
        <//>
      `}
    <//>
  `;
}

function EntityDetail({ entityId, nav }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  useEffect(() => {
    setData(null);
    fetch("/api/entity/" + encodeURIComponent(entityId)).then(r => r.json()).then(setData);
  }, [entityId]);
  if (!data) return html`<${Container} sx=${{ py: 3 }}><${Typography}>loading...<//><//>`;
  if (data.error) return html`<${Container} sx=${{ py: 3 }}><${Typography} color="error">${data.error}<//><//>`;
  const { entity, videos } = data;
  const type = entity?.type || entityId.split(":")[0];
  const canonical = entity?.canonical || entityId.split(":").slice(1).join(":");
  const fmt = s => {
    const n = Math.floor(s);
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  };
  const totalMentions = videos.reduce((n, v) => n + v.mentions.length, 0);
  const showingSearch = showDropdown && text.trim().length > 0;
  return html`
    <${Container} maxWidth="lg" sx=${{ py: 3 }}>
      <${Button} size="small" onClick=${() => nav("/")}>← back<//>
      <${Typography} variant="h4" gutterBottom sx=${{ mt: 1 }}>Entities<//>
      <${Paper} sx=${{ mt: 2, mb: 2, position: "relative" }}>
        <${Box} sx=${{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5 }}>
          <${TextField}
            size="small"
            placeholder="search entities (people, places, orgs…) or catalog"
            value=${text}
            onChange=${e => { setText(e.target.value); setShowDropdown(true); }}
            onFocus=${() => { if (text) setShowDropdown(true); }}
            onKeyDown=${e => {
              if (e.key === "Enter" && text.trim()) { setShowDropdown(false); nav("/?search=" + encodeURIComponent(text.trim())); }
              else if (e.key === "Escape") setShowDropdown(false);
            }}
            sx=${{ flexGrow: 1 }}
            autoFocus
          />
          ${text && html`<${Button} size="small" onClick=${() => { setText(""); setShowDropdown(false); }}>clear<//>`}
          ${text && html`<${Button} size="small" variant="outlined" onClick=${() => { setShowDropdown(false); nav("/?search=" + encodeURIComponent(text.trim())); }}>in catalog<//>`}
        <//>
        ${showDropdown && html`<${EntitySuggestions} text=${text} nav=${nav} onPick=${() => { setText(""); setShowDropdown(false); }} />`}
      <//>
      ${!showingSearch && html`
        <${Box} sx=${{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <${Chip} label=${type} color=${ENTITY_TYPE_COLOR[type] || "default"} size="small" />
          <${Typography} variant="h4">${canonical}<//>
        <//>
        <${Typography} variant="body2" color="text.secondary" sx=${{ mb: 2 }}>
          ${totalMentions} mention${totalMentions === 1 ? "" : "s"} across ${videos.length} video${videos.length === 1 ? "" : "s"}
        <//>
      `}
      ${!showingSearch && videos.length === 0 && html`<${Typography}>no videos contain this entity<//>`}
      ${!showingSearch && html`<${Stack} spacing=${2}>
        ${videos.map(v => html`
          <${Paper} key=${v.videoId} sx=${{ p: 2 }}>
            <${Box} sx=${{ display: "flex", gap: 2, alignItems: "flex-start" }}>
              ${v.thumbnailUrl && html`
                <img src=${v.thumbnailUrl} alt="" width="120" height="68" style=${{ objectFit: "cover", borderRadius: 4, flexShrink: 0, cursor: "pointer" }} onClick=${() => nav("/video/" + v.videoId)} />
              `}
              <${Box} sx=${{ flex: 1, minWidth: 0 }}>
                <${Link} component="button" underline="hover" onClick=${() => nav("/video/" + v.videoId)} sx=${{ textAlign: "left" }}>
                  <${Typography} variant="subtitle1">${v.title || v.videoId}<//>
                <//>
                <${Box} sx=${{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  ${v.mentions.slice(0, 60).map((m, i) => html`
                    <${Link} key=${i} href=${"https://www.youtube.com/watch?v=" + v.videoId + "&t=" + Math.floor(m.timeStart) + "s"} target="_blank" rel="noopener" underline="hover" sx=${{ fontFamily: "monospace", fontSize: 12 }}>
                      [${fmt(m.timeStart)}]
                    <//>
                  `)}
                  ${v.mentions.length > 60 && html`<${Typography} variant="caption" color="text.secondary">+${v.mentions.length - 60} more<//>`}
                <//>
              <//>
            <//>
          <//>
        `)}
      <//>`}
    <//>
  `;
}

const ENTITY_TYPE_HEX = {
  person: "#42a5f5",
  organization: "#ab47bc",
  location: "#66bb6a",
  event: "#ffa726",
  thing: "#29b6f6",
  time: "#bdbdbd",
};

function RelationshipsPage({ nav }) {
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);
  const [rf, setRf] = useState(null);
  const [flowLib, setFlowLib] = useState(null);
  const [layout, setLayout] = useState(null);
  const [positions, setPositions] = useState({});
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const rfInstance = useRef(null);

  useEffect(() => {
    Promise.all([
      import("reactflow"),
      import("d3-force"),
    ]).then(([flow, d3]) => {
      setFlowLib({ flow, d3 });
    }).catch(e => setError(String(e)));
    fetch("/api/relationships")
      .then(r => r.json())
      .then(g => {
        if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
          setGraph({ nodes: [], edges: [] });
        } else {
          setGraph(g);
        }
      })
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!graph || !flowLib) return;
    const { d3 } = flowLib;
    const simNodes = graph.nodes.map(n => ({ ...n }));
    const simLinks = graph.edges.map(e => ({ source: e.source, target: e.target }));
    const sim = d3.forceSimulation(simNodes)
      .force("charge", d3.forceManyBody().strength(-180))
      .force("link", d3.forceLink(simLinks).id(d => d.id).distance(90).strength(0.6))
      .force("center", d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide().radius(30))
      .stop();
    const ticks = Math.min(400, Math.max(120, Math.round(30 + 200 * Math.log2(1 + simNodes.length / 10))));
    for (let i = 0; i < ticks; i++) sim.tick();
    const pos = {};
    for (const n of simNodes) pos[n.id] = { x: n.x, y: n.y };
    setLayout(pos);
    setPositions(pos);
  }, [graph, flowLib]);

  const { nodes, edges } = useMemo(() => {
    if (!graph || !layout) return { nodes: [], edges: [] };
    const ns = graph.nodes.map(n => {
      const p = positions[n.id] || layout[n.id] || { x: 0, y: 0 };
      const color = ENTITY_TYPE_HEX[n.type] || "#888";
      const dim = query && !n.canonical.toLowerCase().includes(query.toLowerCase());
      const selected = selectedId === n.id;
      return {
        id: n.id,
        position: { x: p.x, y: p.y },
        data: { label: n.canonical },
        style: {
          background: color,
          color: "#000",
          border: selected ? "3px solid #fff" : "1px solid rgba(0,0,0,0.3)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 12,
          opacity: dim ? 0.15 : 1,
          minWidth: 40,
        },
      };
    });
    const es = graph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.predicate,
      labelStyle: { fontSize: 10, fill: "#ccc" },
      style: { stroke: "#888", strokeWidth: Math.min(4, 1 + Math.log2(e.count + 1)) },
    }));
    return { nodes: ns, edges: es };
  }, [graph, layout, positions, query, selectedId]);

  const suggestions = useMemo(() => {
    if (!graph || !query.trim()) return [];
    const q = query.toLowerCase();
    return graph.nodes
      .filter(n => n.canonical.toLowerCase().includes(q))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  }, [graph, query]);

  const focusNode = useCallback((id) => {
    const p = layout && layout[id];
    if (!p || !rfInstance.current) return;
    rfInstance.current.setCenter(p.x, p.y, { zoom: 1.3, duration: 500 });
    setSelectedId(id);
  }, [layout]);

  if (error) return html`<${Container} sx=${{ py: 3 }}><${Typography} color="error">${error}<//><//>`;
  if (!graph || !flowLib || !layout) return html`<${Container} sx=${{ py: 3 }}><${Typography}>loading graph…<//><//>`;

  const { flow } = flowLib;
  const ReactFlow = flow.default || flow.ReactFlow;
  const { Background, Controls, MiniMap } = flow;

  return html`
    <${Box} sx=${{ position: "relative", height: "calc(100vh - 64px)", width: "100%" }}>
      <${Paper} sx=${{ position: "absolute", top: 12, left: 12, zIndex: 10, p: 1, width: 320 }}>
        <${TextField}
          size="small"
          fullWidth
          placeholder="search nodes…"
          value=${query}
          onChange=${e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus=${() => setShowDropdown(true)}
          onKeyDown=${e => {
            if (e.key === "Enter" && suggestions[0]) { focusNode(suggestions[0].id); setShowDropdown(false); }
            else if (e.key === "Escape") setShowDropdown(false);
          }}
        />
        ${showDropdown && suggestions.length > 0 && html`
          <${Box} sx=${{ mt: 1, maxHeight: 300, overflow: "auto" }}>
            ${suggestions.map(n => html`
              <${Box}
                key=${n.id}
                sx=${{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderRadius: 1 }}
                onClick=${() => { focusNode(n.id); setShowDropdown(false); }}
              >
                <${Box} sx=${{ width: 10, height: 10, borderRadius: "50%", bgcolor: ENTITY_TYPE_HEX[n.type] || "#888" }} />
                <${Typography} variant="body2" sx=${{ flexGrow: 1 }}>${n.canonical}<//>
                <${Typography} variant="caption" color="text.secondary">${n.weight}<//>
              <//>
            `)}
          <//>
        `}
        <${Box} sx=${{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          ${Object.entries(ENTITY_TYPE_HEX).map(([t, c]) => html`
            <${Box} key=${t} sx=${{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <${Box} sx=${{ width: 10, height: 10, borderRadius: "50%", bgcolor: c }} />
              <${Typography} variant="caption">${t}<//>
            <//>
          `)}
        <//>
        <${Typography} variant="caption" color="text.secondary" sx=${{ display: "block", mt: 0.5 }}>
          ${graph.nodes.length} nodes · ${graph.edges.length} edges
        <//>
      <//>
      <${ReactFlow}
        nodes=${nodes}
        edges=${edges}
        nodesDraggable=${true}
        onInit=${(inst) => { rfInstance.current = inst; setRf(inst); inst.fitView({ padding: 0.2 }); }}
        onNodeDrag=${(_, node) => {
          setPositions(p => ({ ...p, [node.id]: { x: node.position.x, y: node.position.y } }));
        }}
        onNodeDragStop=${(_, node) => {
          setPositions(p => ({ ...p, [node.id]: { x: node.position.x, y: node.position.y } }));
        }}
        onNodeClick=${(_, node) => {
          setSelectedId(node.id);
        }}
        onNodeDoubleClick=${(_, node) => {
          nav("/entity/" + encodeURIComponent(node.id));
        }}
        onPaneClick=${() => setShowDropdown(false)}
        fitView
        minZoom=${0.1}
        maxZoom=${4}
      >
        <${Background} />
        <${Controls} />
        <${MiniMap} nodeColor=${(n) => n.style?.background || "#888"} pannable zoomable />
      <//>
    <//>
  `;
}

const IS_STATIC = typeof window !== "undefined" && window.__STATIC__;

function App() {
  const [path, nav] = useRoute();
  const videoMatch = path.match(/^\/video\/([A-Za-z0-9_-]+)/);
  const entityMatch = path.match(/^\/entity\/([^?]+)/);
  const isRelationships = path === "/relationships" || path.startsWith("/relationships?");
  const isAdmin = !IS_STATIC && path.startsWith("/admin");
  const body = videoMatch
    ? html`<${VideoDetail} videoId=${videoMatch[1]} nav=${nav} />`
    : entityMatch
      ? html`<${EntityDetail} entityId=${decodeURIComponent(entityMatch[1])} nav=${nav} />`
      : isRelationships
        ? html`<${RelationshipsPage} nav=${nav} />`
        : isAdmin
          ? html`<${AdminPage} nav=${nav} />`
          : html`<${CatalogList} nav=${nav} />`;
  return html`
    <${ThemeProvider} theme=${theme}>
      <${CssBaseline} />
      <${AppBar} position="static" color="default">
        <${Toolbar}>
          <${Typography} variant="h6" sx=${{ cursor: "pointer", flexGrow: 1 }} onClick=${() => nav("/")}>Why Files Database<//>
          <${Button} color="inherit" onClick=${() => nav("/")}>home<//>
          <${Button} color="inherit" onClick=${() => nav("/relationships")}>relationships<//>
          ${!IS_STATIC && html`<${Button} color="inherit" onClick=${() => nav("/admin")}>admin<//>`}
        <//>
      <//>
      ${body}
    <//>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
