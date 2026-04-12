// Material UI SPA shell.
//
// Ships a zero-build-step page that loads React + MUI from esm.sh via an
// importmap, uses htm for JSX-less templating, and polls the JSON API on
// this same server. Rendering the whole SPA as one inline module keeps the
// server handler responsible for exactly one HTML artifact.
//
// Routes handled client-side:
//   /          → catalog list + ingest progress
//   /video/:id → transcript detail with deep-linked timestamps

const CLIENT_SCRIPT = `
import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import {
  CssBaseline, ThemeProvider, createTheme, AppBar, Toolbar, Typography,
  Container, Paper, Table, TableHead, TableBody, TableRow, TableCell,
  TextField, Select, MenuItem, LinearProgress, Chip, Button, Box, Link, Stack,
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
  };
  return [path, nav];
}

function useProgress() {
  const [p, setP] = useState({ running: false, total: 0, done: 0, failed: 0 });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/progress");
        if (!stop) setP(await r.json());
      } catch {}
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, []);
  return p;
}

function ProgressBar({ progress }) {
  const pct = progress.total > 0 ? ((progress.done + progress.failed) / progress.total) * 100 : 0;
  const label = progress.running
    ? \`ingesting \${progress.done + progress.failed} / \${progress.total}\${progress.current ? " — " + progress.current : ""}\`
    : progress.total > 0
      ? \`idle — last run: \${progress.done} ok, \${progress.failed} failed\`
      : "idle";
  return html\`
    <\${Box} sx=\${{ my: 2 }}>
      <\${Typography} variant="body2" sx=\${{ mb: 0.5 }}>\${label}<//>
      <\${LinearProgress} variant=\${progress.running ? "determinate" : "determinate"} value=\${pct} />
      \${progress.lastError && html\`<\${Typography} variant="caption" color="error">\${progress.lastError}<//>\`}
    <//>
  \`;
}

function StatusChip({ status }) {
  const color = status === "fetched" ? "success" : status === "pending" ? "default" : "warning";
  return html\`<\${Chip} size="small" label=\${status} color=\${color} />\`;
}

function CatalogList({ nav }) {
  const [data, setData] = useState({ total: 0, page: 1, pageSize: 25, rows: [] });
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const progress = useProgress();

  useEffect(() => {
    const q = new URLSearchParams();
    if (text) q.set("text", text);
    if (status) q.set("status", status);
    fetch("/api/catalog?" + q).then(r => r.json()).then(setData);
  }, [text, status, progress.done, progress.failed, progress.running]);

  const startIngest = () => fetch("/api/ingest/start", { method: "POST" });

  return html\`
    <\${Container} maxWidth="lg" sx=\${{ py: 3 }}>
      <\${Typography} variant="h4" gutterBottom>captions<//>
      <\${ProgressBar} progress=\${progress} />
      <\${Stack} direction="row" spacing=\${2} sx=\${{ mb: 2 }}>
        <\${TextField} size="small" label="search" value=\${text} onChange=\${e => setText(e.target.value)} />
        <\${Select} size="small" value=\${status} displayEmpty onChange=\${e => setStatus(e.target.value)} sx=\${{ minWidth: 180 }}>
          <\${MenuItem} value="">any status<//>
          <\${MenuItem} value="pending">pending<//>
          <\${MenuItem} value="fetched">fetched<//>
          <\${MenuItem} value="failed-retryable">failed-retryable<//>
          <\${MenuItem} value="failed-needs-user">failed-needs-user<//>
        <//>
        <\${Button} variant="contained" onClick=\${startIngest} disabled=\${progress.running}>
          \${progress.running ? "running..." : "run ingest"}
        <//>
      <//>
      <\${Paper}>
        <\${Table} size="small">
          <\${TableHead}>
            <\${TableRow}>
              <\${TableCell}>id<//>
              <\${TableCell}>title<//>
              <\${TableCell}>channel<//>
              <\${TableCell}>status<//>
              <\${TableCell}>fetched<//>
            <//>
          <//>
          <\${TableBody}>
            \${data.rows.map(r => html\`
              <\${TableRow} key=\${r.videoId} hover style=\${{ cursor: "pointer" }} onClick=\${() => nav("/video/" + r.videoId)}>
                <\${TableCell}>\${r.videoId}<//>
                <\${TableCell}>\${r.title || ""}<//>
                <\${TableCell}>\${r.channel || ""}<//>
                <\${TableCell}><\${StatusChip} status=\${r.status} /><//>
                <\${TableCell}>\${r.fetchedAt || ""}<//>
              <//>
            \`)}
          <//>
        <//>
      <//>
      <\${Typography} variant="caption" sx=\${{ mt: 1, display: "block" }}>\${data.total} videos<//>
    <//>
  \`;
}

function VideoDetail({ videoId, nav }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch("/api/video/" + encodeURIComponent(videoId)).then(r => r.json()).then(setData);
  }, [videoId]);
  if (!data) return html\`<\${Container} sx=\${{ py: 3 }}><\${Typography}>loading...<//><//>\`;
  if (data.error) return html\`<\${Container} sx=\${{ py: 3 }}><\${Typography} color="error">\${data.error}<//><//>\`;
  const { row, transcript } = data;
  const cues = transcript?.cues || [];
  const fmt = s => {
    const n = Math.floor(s);
    return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  };
  return html\`
    <\${Container} maxWidth="md" sx=\${{ py: 3 }}>
      <\${Button} size="small" onClick=\${() => nav("/")}>← back<//>
      <\${Typography} variant="h5" sx=\${{ mt: 2 }}>\${row.title || row.videoId}<//>
      <\${Typography} variant="body2" color="text.secondary">
        \${row.channel || ""} · <\${StatusChip} status=\${row.status} />
      <//>
      \${!transcript && html\`<\${Typography} sx=\${{ mt: 2 }}>no transcript on disk<//>\`}
      \${transcript && html\`
        <\${Paper} sx=\${{ mt: 2, p: 2, maxHeight: "70vh", overflow: "auto" }}>
          \${cues.map((c, i) => html\`
            <\${Box} key=\${i} sx=\${{ py: 0.5 }}>
              <\${Link} href=\${"https://www.youtube.com/watch?v=" + row.videoId + "&t=" + Math.floor(c.start) + "s"} target="_blank" underline="hover">
                [\${fmt(c.start)}]
              <//>
              \${" " + c.text}
            <//>
          \`)}
        <//>
      \`}
    <//>
  \`;
}

function App() {
  const [path, nav] = useRoute();
  const match = path.match(/^\\/video\\/([A-Za-z0-9_-]+)/);
  const body = match
    ? html\`<\${VideoDetail} videoId=\${match[1]} nav=\${nav} />\`
    : html\`<\${CatalogList} nav=\${nav} />\`;
  return html\`
    <\${ThemeProvider} theme=\${theme}>
      <\${CssBaseline} />
      <\${AppBar} position="static" color="default">
        <\${Toolbar}>
          <\${Typography} variant="h6" sx=\${{ cursor: "pointer" }} onClick=\${() => nav("/")}>captions<//>
        <//>
      <//>
      \${body}
    <//>
  \`;
}

createRoot(document.getElementById("root")).render(html\`<\${App} />\`);
`;

export function renderSpaShell(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<title>captions</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="preconnect" href="https://esm.sh"/>
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "htm": "https://esm.sh/htm@3.1.1",
    "@mui/material": "https://esm.sh/@mui/material@5.16.7?external=react,react-dom",
    "@emotion/react": "https://esm.sh/@emotion/react@11.11.4?external=react",
    "@emotion/styled": "https://esm.sh/@emotion/styled@11.11.5?external=react,@emotion/react"
  }
}
</script>
</head><body>
<div id="root"></div>
<script type="module">
${CLIENT_SCRIPT}
</script>
</body></html>`;
}
