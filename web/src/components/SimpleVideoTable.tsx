import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Paper, Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  TableSortLabel, Box, Button, Menu, MenuItem, Checkbox, ListItemIcon,
  ListItemText, Typography,
} from "@mui/material";
import { CATALOG_COLUMNS } from "./catalog-columns";
import type { CatalogColumn, VideoRow } from "../types";

interface Props {
  rows: VideoRow[];
  columns?: CatalogColumn[];
  title?: string;
}

type SortDir = "asc" | "desc";

// Columns that don't represent a sortable field (pure presentation /
// nested-data cells). Clicking these headers is a no-op.
const UNSORTABLE = new Set(["thumbnail"]);

function rawValue(row: VideoRow, key: string): unknown {
  // Stage columns encode as "stage:<name>" — sort by presence.
  if (key.startsWith("stage:")) {
    const s = (row.stages || {}) as Record<string, unknown>;
    return s[key.slice(6)] ? 1 : 0;
  }
  return (row as Record<string, unknown>)[key];
}

function compareVals(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;  // nulls sort to end
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (a === b) ? 0 : (a ? -1 : 1);
  }
  const as = String(a);
  const bs = String(b);
  // ISO dates sort correctly as strings; fall through to locale compare.
  return as.localeCompare(bs, undefined, { numeric: true });
}

export function SimpleVideoTable({ rows, columns, title }: Props) {
  const nav = useNavigate();
  const cols = columns || CATALOG_COLUMNS;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string>("publishDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of cols) init[c.key] = c.default;
    return init;
  });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const activeCols = cols.filter((c) => visible[c.key]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    const sign = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => sign * compareVals(rawValue(a, sortKey), rawValue(b, sortKey)));
    return arr;
  }, [rows, sortKey, sortDir]);

  const sliced = useMemo(() => {
    const start = page * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const handleSort = (key: string) => {
    if (UNSORTABLE.has(key)) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  };

  const pagination = (
    <TablePagination
      component="div"
      count={sorted.length}
      page={page}
      onPageChange={(_, p) => setPage(p)}
      rowsPerPage={pageSize}
      onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
      rowsPerPageOptions={[10, 25, 50, 100]}
    />
  );

  return (
    <Paper>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="body2" sx={{ flexGrow: 1, color: "text.secondary" }}>
          {title || `${rows.length} video${rows.length === 1 ? "" : "s"}`}
        </Typography>
        <Button size="small" variant="outlined" onClick={(e) => setMenuAnchor(e.currentTarget)}>
          columns ▾
        </Button>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { maxHeight: 400 } } }}
        >
          {cols.map((c) => (
            <MenuItem key={c.key} onClick={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))} dense>
              <ListItemIcon><Checkbox edge="start" size="small" checked={!!visible[c.key]} tabIndex={-1} disableRipple /></ListItemIcon>
              <ListItemText primary={c.menuLabel || c.label} />
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {pagination}
      <Table size="small">
        <TableHead>
          <TableRow>
            {activeCols.map((c) => {
              const sortable = !UNSORTABLE.has(c.key);
              const active = sortKey === c.key;
              return (
                <TableCell
                  key={c.key}
                  sx={c.headSx || c.cellSx || {}}
                  sortDirection={active ? sortDir : false}
                >
                  {sortable ? (
                    <TableSortLabel
                      active={active}
                      direction={active ? sortDir : "asc"}
                      onClick={() => handleSort(c.key)}
                    >
                      {c.label}
                    </TableSortLabel>
                  ) : c.label}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {sliced.map((r) => (
            <TableRow key={r.videoId} hover style={{ cursor: "pointer" }} onClick={() => nav("/video/" + r.videoId)}>
              {activeCols.map((c) => (
                <TableCell key={c.key} sx={c.cellSx || {}}>{c.render(r)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pagination}
    </Paper>
  );
}
