// Shared column definitions + small render helpers used by the home catalog
// table and any other page that wants to render video rows (e.g. facets).

import { Chip, Link } from "@mui/material";

export interface VideoRow {
  videoId: string;
  title?: string;
  channel?: string;
  channelId?: string;
  description?: string;
  publishDate?: string;
  uploadDate?: string;
  category?: string;
  status?: string;
  sourceUrl?: string;
  transcriptPath?: string;
  thumbnailUrl?: string;
  lengthSeconds?: number;
  viewCount?: number;
  isLiveContent?: boolean;
  errorReason?: string;
  lastError?: string;
  [k: string]: unknown;
}

export interface CatalogColumn {
  key: string;
  label: string;
  menuLabel?: string;
  default: boolean;
  headSx?: Record<string, unknown>;
  cellSx?: Record<string, unknown>;
  render: (r: VideoRow) => React.ReactNode;
}

export const ENTITY_TYPE_COLOR: Record<string, string> = {
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

export const fmtDate = (d?: string): string => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  return t.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export const truncate = (s: string | undefined, n: number): string => {
  if (!s) return "";
  const clean = String(s).replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "..." : clean;
};

export const descriptionPreview = (s: string | undefined, n: number): string => {
  if (!s) return "";
  const nl = s.indexOf("\n");
  const rest = nl >= 0 ? s.slice(nl + 1) : s;
  return truncate(rest, n);
};

export const CATALOG_COLUMNS: CatalogColumn[] = [
  {
    key: "thumbnail", label: "", menuLabel: "Thumbnail", default: true,
    headSx: { width: 72 }, cellSx: { p: 0.5 },
    render: (r) => r.thumbnailUrl
      ? <img src={r.thumbnailUrl} alt="" width="64" height="64" style={{ objectFit: "contain", display: "block", borderRadius: 2, background: "transparent" }} />
      : null,
  },
  { key: "videoId", label: "ID", default: false, render: (r) => r.videoId },
  {
    key: "title", label: "Title", default: true,
    headSx: { width: 240 }, cellSx: { width: 240 },
    render: (r) => (
      <Link
        href={r.sourceUrl || ("https://www.youtube.com/watch?v=" + r.videoId)}
        target="_blank" rel="noopener" underline="hover"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {r.title || r.videoId}
      </Link>
    ),
  },
  { key: "channel", label: "Channel", default: false, render: (r) => r.channel || "" },
  { key: "channelId", label: "Channel ID", default: false, render: (r) => r.channelId || "" },
  {
    key: "description", label: "Description", default: true,
    headSx: { width: 480 },
    cellSx: { width: 480, maxWidth: 480, color: "text.secondary" },
    render: (r) => descriptionPreview(r.description, 100),
  },
  { key: "publishDate", label: "Published", default: true, render: (r) => fmtDate(r.publishDate) },
  { key: "status", label: "Status", default: true, render: (r) => <StatusChip status={r.status || ""} /> },
  { key: "uploadDate", label: "Uploaded", default: false, render: (r) => fmtDate(r.uploadDate) },
  { key: "category", label: "Category", default: false, render: (r) => r.category || "" },
  {
    key: "lengthSeconds", label: "Length", default: false,
    render: (r) => r.lengthSeconds ? `${Math.floor(r.lengthSeconds / 60)}m` : "",
  },
  {
    key: "viewCount", label: "Views", default: false,
    render: (r) => r.viewCount ? r.viewCount.toLocaleString() : "",
  },
  { key: "isLiveContent", label: "Live", default: false, render: (r) => r.isLiveContent ? "yes" : "" },
  {
    key: "sourceUrl", label: "Source URL", default: false,
    render: (r) => r.sourceUrl
      ? <Link href={r.sourceUrl} target="_blank" rel="noopener" underline="hover" onClick={(e: React.MouseEvent) => e.stopPropagation()}>{r.sourceUrl}</Link>
      : "",
  },
  { key: "transcriptPath", label: "Transcript Path", default: false, render: (r) => r.transcriptPath || "" },
  { key: "errorReason", label: "Error", default: false, render: (r) => r.errorReason || "" },
  {
    key: "lastError", label: "Last Error", default: false,
    cellSx: { maxWidth: 320, color: "text.secondary" },
    render: (r) => r.lastError || "",
  },
];
