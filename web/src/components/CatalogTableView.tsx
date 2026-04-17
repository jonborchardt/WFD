// Shared table: search box, column toggle, pagination, row rendering.
// Used by both the public CatalogPage and the admin AdminCatalogTable.
// Data-fetching strategy is left to the caller (client-side filter vs /api/*).

import { ReactNode, useState } from "react";
import {
  Paper, Table, TableHead, TableBody, TableRow, TableCell,
  TablePagination, TextField, Box, Button, Menu, MenuItem,
  Checkbox, ListItemIcon, ListItemText,
} from "@mui/material";
import { EntitySuggestions } from "./EntitySuggestions";
import type { VideoRow, CatalogColumn } from "../types";

interface Props {
  columns: CatalogColumn[];
  rows: VideoRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (ps: number) => void;
  text: string;
  onTextChange: (t: string) => void;
  onRowClick: (r: VideoRow) => void;
  onSuggestionNavigate: (to: string) => void;
  toolbarExtras?: ReactNode;
}

export function CatalogTableView({
  columns, rows, total, page, pageSize, onPageChange, onPageSizeChange,
  text, onTextChange, onRowClick, onSuggestionNavigate, toolbarExtras,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of columns) init[c.key] = c.default;
    return init;
  });
  const [colMenuAnchor, setColMenuAnchor] = useState<HTMLElement | null>(null);
  const activeCols = columns.filter((c) => visible[c.key]);

  const pagination = (
    <TablePagination
      component="div"
      count={total}
      page={page - 1}
      onPageChange={(_, p) => onPageChange(p + 1)}
      rowsPerPage={pageSize}
      onRowsPerPageChange={(e) => { onPageSizeChange(parseInt(e.target.value, 10)); onPageChange(1); }}
      rowsPerPageOptions={[10, 25, 50, 100]}
    />
  );

  return (
    <Paper>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          placeholder="search"
          value={text}
          onChange={(e) => { onTextChange(e.target.value); setShowDropdown(true); }}
          onFocus={() => { if (text) setShowDropdown(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { setShowDropdown(false); (e.target as HTMLInputElement).blur(); }
            else if (e.key === "Escape") setShowDropdown(false);
          }}
        />
        {toolbarExtras}
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" variant="outlined" onClick={(e) => setColMenuAnchor(e.currentTarget)}>
          columns ▾
        </Button>
        <Menu
          anchorEl={colMenuAnchor}
          open={Boolean(colMenuAnchor)}
          onClose={() => setColMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { maxHeight: 400 } } }}
        >
          {columns.map((c) => (
            <MenuItem key={c.key} onClick={() => setVisible((v) => ({ ...v, [c.key]: !v[c.key] }))} dense>
              <ListItemIcon><Checkbox edge="start" size="small" checked={!!visible[c.key]} tabIndex={-1} disableRipple /></ListItemIcon>
              <ListItemText primary={c.menuLabel || c.label} />
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {showDropdown && (
        <EntitySuggestions
          text={text}
          onNavigate={onSuggestionNavigate}
          onPick={() => setShowDropdown(false)}
        />
      )}
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
          {rows.map((r) => (
            <TableRow key={r.videoId} hover style={{ cursor: "pointer" }} onClick={() => onRowClick(r)}>
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
