// Shared chrome for the faceted pages (/videos, /claims,
// /contradictions). Each page's own rail + results content plugs into
// the slots so the pages stay specific to their domain while the
// page-level shape is consistent.
//
// Four pieces:
//   - FacetsPageHeader: left-aligned title, total-count caption,
//     filtered-match caption (when different from total), and a
//     trailing suffix slot (used for the "graph these" button)
//   - FacetsPageOuter: outer max-width + padding wrapper
//   - RailResultsLayout: the 1/3 + 2/3 flex split
//   - DebouncedSearchField: the rail's free-text input with a local
//     buffer + 180 ms commit so keystrokes don't re-filter the whole
//     list per character; resyncs when the parent value changes
//     (URL hydration, clear-all).

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box, Button, Collapse, TextField, Typography,
  useMediaQuery, useTheme,
} from "@mui/material";

interface HeaderProps {
  title: string;
  matchCount: number;
  totalCount: number;
  /** Override the default "items"/"in corpus" phrasing if needed. */
  nounPlural?: string;
  suffix?: ReactNode;
  /** Optional one-paragraph blurb explaining what this page surfaces. */
  description?: ReactNode;
}

export function FacetsPageHeader({
  title, matchCount, totalCount, nounPlural, suffix, description,
}: HeaderProps) {
  const totalLabel =
    `${totalCount.toLocaleString()} ${nounPlural ?? "in corpus"}`;
  const matchLabel =
    matchCount === totalCount
      ? null
      : `${matchCount.toLocaleString()} match`;
  // Left-aligned row: title, total, filtered-match (when different
  // from total), then the caller's suffix (e.g. "graph these"). No
  // flex-grow spacer — everything sits snug on the left. Optional
  // description renders below as a muted sentence.
  return (
    <Box sx={{ mb: description ? 1.5 : 1 }}>
      <Box sx={{
        display: "flex", alignItems: "baseline",
        gap: 1.5, mb: description ? 0.5 : 0, flexWrap: "wrap",
      }}>
        <Typography variant="h5" sx={{ m: 0 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {totalLabel}
        </Typography>
        {matchLabel && (
          <Typography variant="caption" color="text.secondary">
            {matchLabel}
          </Typography>
        )}
        {suffix}
      </Box>
      {description && (
        <Typography variant="body2" sx={{
          color: "text.secondary", maxWidth: 760,
        }}>
          {description}
        </Typography>
      )}
    </Box>
  );
}

interface LayoutProps {
  rail: ReactNode;
  results: ReactNode;
  /** Count of applied filters, shown on the mobile toggle button. */
  filterCount?: number;
}

export function RailResultsLayout({ rail, results, filterCount }: LayoutProps) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  // Below md, rail stacks above results behind a toggle. Default open on
  // tablet-ish widths (sm) where there's enough room to see both at once,
  // collapsed on phones where the rail would otherwise push results
  // off-screen.
  const isTablet = useMediaQuery(theme.breakpoints.only("sm"));
  const [railOpen, setRailOpen] = useState(isTablet);

  if (isWide) {
    return (
      <Box sx={{ display: "flex", gap: 2 }}>
        <Box sx={{
          flex: "1 1 0", minWidth: 0,
          maxWidth: "calc((100% - 16px) / 3)",
        }}>
          {rail}
        </Box>
        <Box sx={{ flex: "2 1 0", minWidth: 0 }}>
          {results}
        </Box>
      </Box>
    );
  }

  const label = filterCount && filterCount > 0
    ? `Filters · ${filterCount}`
    : "Filters";
  return (
    <Box>
      <Button
        onClick={() => setRailOpen((o) => !o)}
        size="small"
        variant="outlined"
        fullWidth
        aria-expanded={railOpen}
        sx={{ mb: 1 }}
      >
        {railOpen ? `Hide ${label.toLowerCase()}` : label}
      </Button>
      <Collapse in={railOpen} unmountOnExit={false}>
        <Box sx={{ mb: 2 }}>{rail}</Box>
      </Collapse>
      <Box sx={{ minWidth: 0 }}>{results}</Box>
    </Box>
  );
}

interface OuterProps {
  children: ReactNode;
}

/**
 * Outer Container-equivalent — the three faceted pages all want the
 * same max-width + padding. Use this as the root element so title +
 * RailResultsLayout share the same gutters.
 */
export function FacetsPageOuter({ children }: OuterProps) {
  return (
    <Box sx={{
      px: { xs: 1.5, sm: 2 }, py: 2,
      maxWidth: { xs: "100%", md: 1800 }, mx: "auto",
    }}>
      {children}
    </Box>
  );
}

interface SearchProps {
  /** Current committed value from the filter state; drives URL sync. */
  value: string;
  /** Fires when the debounce elapses and the input value is stable. */
  onCommit: (next: string) => void;
  placeholder?: string;
  /** Ms before uncommitted keystrokes are propagated. */
  delay?: number;
}

/**
 * Free-text input that keeps a local buffer and commits to `onCommit`
 * after a short idle delay. If `value` changes from outside (URL
 * hydration, clearAll), the local buffer resyncs.
 */
export function DebouncedSearchField({
  value, onCommit, placeholder, delay = 180,
}: SearchProps) {
  const [local, setLocal] = useState(value);

  // External resets (clearAll, URL hydration on mount) override the
  // local buffer so the displayed text never lies about what's applied.
  const lastExternal = useRef(value);
  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      setLocal(value);
    }
  }, [value]);

  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => {
      lastExternal.current = local;
      onCommit(local);
    }, delay);
    return () => clearTimeout(t);
  }, [local, value, onCommit, delay]);

  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      fullWidth
      sx={{ mb: 1 }}
    />
  );
}
