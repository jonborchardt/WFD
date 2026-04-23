import { Chip, Link, Tooltip } from "@mui/material";
import type { VideoRow, CatalogColumn } from "../types";
import { fmtDate, descriptionPreview } from "../lib/format";
import { useOpenVideo } from "./VideoLightbox";

function CatalogTitleLink({ row }: { row: VideoRow }) {
  const openVideo = useOpenVideo();
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        openVideo({ videoId: row.videoId, title: row.title, sourceUrl: row.sourceUrl });
      }}
      sx={{ textAlign: "left" }}
    >
      {row.title || row.videoId}
    </Link>
  );
}

export const ENTITY_TYPE_COLOR: Record<string, "primary" | "secondary" | "success" | "warning" | "info" | "default"> = {
  person: "primary",
  organization: "secondary",
  location: "success",
  event: "warning",
  thing: "info",
  misc: "info",
  time: "default",
};

export function StatusChip({ status }: { status: string }) {
  const color = status === "fetched" ? "success" : status === "pending" ? "default" : "warning";
  return <Chip size="small" label={status} color={color} />;
}

export const CATALOG_COLUMNS: CatalogColumn[] = [
  {
    key: "thumbnail", label: "", menuLabel: "Thumbnail", default: true,
    headSx: { width: 72 }, cellSx: { p: 0.5 },
    render: (r: VideoRow) => r.thumbnailUrl
      ? <img src={r.thumbnailUrl} alt="" width="64" height="64" style={{ objectFit: "contain", display: "block", borderRadius: 2, background: "transparent" }} />
      : null,
  },
  { key: "videoId", label: "ID", default: false, render: (r: VideoRow) => r.videoId },
  {
    key: "title", label: "Title", default: true,
    headSx: { width: 240 }, cellSx: { width: 240 },
    render: (r: VideoRow) => <CatalogTitleLink row={r} />,
  },
  { key: "channel", label: "Channel", default: false, render: (r: VideoRow) => r.channel || "" },
  { key: "channelId", label: "Channel ID", default: false, render: (r: VideoRow) => r.channelId || "" },
  {
    key: "description", label: "Description", default: true,
    headSx: { width: 480 },
    cellSx: { width: 480, maxWidth: 480, color: "text.secondary" },
    render: (r: VideoRow) => descriptionPreview(r.description, 100),
  },
  { key: "publishDate", label: "Published", default: true, render: (r: VideoRow) => fmtDate(r.publishDate) },
  { key: "uploadDate", label: "Uploaded", default: false, render: (r: VideoRow) => fmtDate(r.uploadDate) },
  { key: "category", label: "Category", default: false, render: (r: VideoRow) => r.category || "" },
  {
    key: "lengthSeconds", label: "Length", default: true,
    render: (r: VideoRow) => r.lengthSeconds ? `${Math.floor(r.lengthSeconds / 60)}m` : "",
  },
  {
    key: "viewCount", label: "Views", default: true,
    render: (r: VideoRow) => r.viewCount ? r.viewCount.toLocaleString() : "",
  },
  { key: "isLiveContent", label: "Live", default: false, render: (r: VideoRow) => r.isLiveContent ? "yes" : "" },
  {
    key: "sourceUrl", label: "Source URL", default: false,
    render: (r: VideoRow) => r.sourceUrl
      ? <Link href={r.sourceUrl} target="_blank" rel="noopener" underline="hover" onClick={(e: React.MouseEvent) => e.stopPropagation()}>{r.sourceUrl}</Link>
      : "",
  },
  { key: "transcriptPath", label: "Transcript Path", default: false, render: (r: VideoRow) => r.transcriptPath || "" },
  { key: "errorReason", label: "Error", default: false, render: (r: VideoRow) => r.errorReason || "" },
  {
    key: "lastError", label: "Last Error", default: false,
    cellSx: { maxWidth: 320, color: "text.secondary" },
    render: (r: VideoRow) => r.lastError || "",
  },
];

// --- Admin-only columns (pipeline stage status) ---

// Display order in the admin table. `ai` comes after `per-claim`.
const DISPLAY_STAGES = ["fetched", "entities", "relations", "per-claim", "ai"];

// Actual dependency graph: ai and per-claim are parallel siblings after relations.
const STAGE_PREREQS: Record<string, string[]> = {
  fetched: [],
  entities: ["fetched"],
  relations: ["fetched", "entities"],
  ai: ["fetched", "entities", "relations"],
  "per-claim": ["fetched", "entities", "relations"],
};

// Only `ai` is visible by default; the rest can be enabled via column menu.
const STAGE_DEFAULT_VISIBLE: Record<string, boolean> = {
  fetched: false,
  entities: false,
  relations: false,
  "per-claim": false,
  ai: true,
};

function stageCellFor(stageName: string) {
  return (r: VideoRow) => {
    const stages = (r.stages || {}) as Record<string, unknown>;
    if (stages[stageName]) {
      return <Chip size="small" color="success" label="pass" />;
    }
    const priorAllPass = (STAGE_PREREQS[stageName] || []).every((s) => stages[s]);
    const hasError = r.status === "failed-retryable" || r.status === "failed-needs-user" || !!r.lastError;
    if (priorAllPass && hasError) {
      const reason = r.errorReason || r.lastError || "failed";
      return (
        <Tooltip title={r.lastError || reason}>
          <Chip size="small" color="error" label={"fail: " + reason} />
        </Tooltip>
      );
    }
    return <Chip size="small" variant="outlined" label="pending" />;
  };
}

const STAGE_COLUMNS: CatalogColumn[] = DISPLAY_STAGES.map((s) => ({
  key: "stage:" + s,
  label: s,
  default: STAGE_DEFAULT_VISIBLE[s] ?? false,
  render: stageCellFor(s),
}));

export const ADMIN_COLUMNS: CatalogColumn[] = (() => {
  const hidden = new Set(["status", "errorReason", "lastError"]);
  const base = CATALOG_COLUMNS.filter((c) => !hidden.has(c.key));
  const idx = base.findIndex((c) => c.key === "sourceUrl");
  const ordered = [
    ...base.slice(0, idx + 1),
    ...STAGE_COLUMNS,
    ...base.slice(idx + 1),
  ];
  return ordered.map((c) => c.key === "sourceUrl" ? { ...c, default: true } : c);
})();
