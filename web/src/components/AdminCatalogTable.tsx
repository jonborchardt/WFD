// Server-backed catalog table for admin mode.
// Fetches /api/catalog with server-side pagination and `incompleteStages` filter.
// Shows ALL video statuses and pipeline stage columns.

import { useState, useEffect } from "react";
import { Checkbox, FormControlLabel } from "@mui/material";
import { ADMIN_COLUMNS } from "./catalog-columns";
import { CatalogTableView } from "./CatalogTableView";
import type { VideoRow } from "../types";

interface ApiResult {
  total: number;
  page: number;
  pageSize: number;
  rows: VideoRow[];
}

interface Props {
  onRowClick: (r: VideoRow) => void;
}

export function AdminCatalogTable({ onRowClick }: Props) {
  const [data, setData] = useState<ApiResult>({ total: 0, page: 1, pageSize: 25, rows: [] });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [text, setText] = useState("");
  const [failedOnly, setFailedOnly] = useState(true);

  useEffect(() => { setPage(1); }, [text, failedOnly]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (text) q.set("text", text);
    if (failedOnly) q.set("incompleteStages", "1");
    q.set("page", String(page));
    q.set("pageSize", String(pageSize));
    let cancelled = false;
    const delay = text ? 200 : 0;
    const h = setTimeout(() => {
      fetch("/api/catalog?" + q)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setData(d); })
        .catch(() => {});
    }, delay);
    return () => { cancelled = true; clearTimeout(h); };
  }, [text, failedOnly, page, pageSize]);

  return (
    <CatalogTableView
      columns={ADMIN_COLUMNS}
      rows={data.rows}
      total={data.total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      text={text}
      onTextChange={setText}
      onRowClick={onRowClick}
      onSuggestionNavigate={(to) => { window.location.href = to; }}
      toolbarExtras={
        <FormControlLabel
          control={<Checkbox size="small" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />}
          label="failed"
        />
      }
    />
  );
}
