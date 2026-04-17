import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Paper, Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Box, Button, Menu, MenuItem, Checkbox, ListItemIcon, ListItemText, Typography,
} from "@mui/material";
import { CATALOG_COLUMNS } from "./catalog-columns";
import type { CatalogColumn, VideoRow } from "../types";

interface Props {
  rows: VideoRow[];
  columns?: CatalogColumn[];
  title?: string;
}

export function SimpleVideoTable({ rows, columns, title }: Props) {
  const nav = useNavigate();
  const cols = columns || CATALOG_COLUMNS;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of cols) init[c.key] = c.default;
    return init;
  });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const activeCols = cols.filter((c) => visible[c.key]);

  const sliced = useMemo(() => {
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const pagination = (
    <TablePagination
      component="div"
      count={rows.length}
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
            {activeCols.map((c) => (
              <TableCell key={c.key} sx={c.headSx || c.cellSx || {}}>{c.label}</TableCell>
            ))}
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
