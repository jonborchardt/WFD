import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Chip,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Link as MuiLink,
  Stack,
} from "@mui/material";
import {
  fetchClaimsIndex,
  fetchContradictions,
  fetchDependencyGraph,
} from "../lib/data";
import { TruthBar } from "../components/TruthBar";
import { PageLoading } from "../components/PageLoading";
import { matchesTopic } from "../lib/claim-search";
import { beginLoad } from "../lib/loading";
import type { ClaimsIndexEntry } from "../types";

type SortMode = "certain" | "uncertain" | "contradicted";

export function ClaimsPage() {
  const nav = useNavigate();
  const [entries, setEntries] = useState<ClaimsIndexEntry[] | null>(null);
  const [contradictionCount, setContradictionCount] = useState<Map<string, number>>(new Map());
  const [depCounts, setDepCounts] = useState<Map<string, { out: number; in: number }>>(new Map());
  const [sort, setSort] = useState<SortMode>("certain");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    const endLoad = beginLoad();
    Promise.allSettled([
      fetchClaimsIndex().then((idx) => setEntries(idx?.claims ?? [])),
      fetchContradictions().then((cx) => {
        const m = new Map<string, number>();
        for (const c of cx?.contradictions ?? []) {
          m.set(c.left, (m.get(c.left) ?? 0) + 1);
          m.set(c.right, (m.get(c.right) ?? 0) + 1);
        }
        setContradictionCount(m);
      }),
      fetchDependencyGraph().then((d) => {
        const m = new Map<string, { out: number; in: number }>();
        for (const e of d?.edges ?? []) {
          const from = m.get(e.from) ?? { out: 0, in: 0 };
          from.out += 1;
          m.set(e.from, from);
          const to = m.get(e.to) ?? { out: 0, in: 0 };
          to.in += 1;
          m.set(e.to, to);
        }
        setDepCounts(m);
      }),
    ]).finally(endLoad);
  }, []);

  // Rows that pass text + topic filters, before the kind tab is applied.
  // Used both to feed the final list and to compute per-kind counts for
  // the tab labels.
  const beforeKind = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((c) => {
      if (q && !c.text.toLowerCase().includes(q)) return false;
      if (!matchesTopic(c, tagQuery)) return false;
      return true;
    });
  }, [entries, query, tagQuery]);

  const kindCounts = useMemo(() => {
    const out: Record<string, { matched: number; total: number }> = {};
    const all = entries ?? [];
    for (const c of all) {
      const slot = out[c.kind] ?? { matched: 0, total: 0 };
      slot.total += 1;
      out[c.kind] = slot;
    }
    for (const c of beforeKind) {
      const slot = out[c.kind] ?? { matched: 0, total: 0 };
      slot.matched += 1;
      out[c.kind] = slot;
    }
    return out;
  }, [entries, beforeKind]);

  const filtered = useMemo(() => {
    if (kindFilter === "") return beforeKind;
    return beforeKind.filter((c) => c.kind === kindFilter);
  }, [beforeKind, kindFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    if (sort === "certain") {
      rows.sort((a, b) => {
        const ta = truthValue(a) ?? 0.5;
        const tb = truthValue(b) ?? 0.5;
        return Math.abs(tb - 0.5) - Math.abs(ta - 0.5);
      });
    } else if (sort === "uncertain") {
      rows.sort((a, b) => {
        const ta = truthValue(a) ?? 0.5;
        const tb = truthValue(b) ?? 0.5;
        return Math.abs(ta - 0.5) - Math.abs(tb - 0.5);
      });
    } else {
      rows.sort(
        (a, b) => (contradictionCount.get(b.id) ?? 0) - (contradictionCount.get(a.id) ?? 0),
      );
    }
    return rows.slice(0, 200);
  }, [filtered, sort, contradictionCount]);

  if (!entries) {
    return <PageLoading label="loading claims…" hint="fetching claims index" />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Claims{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {filtered.length === entries.length
            ? `${entries.length} in corpus`
            : `${filtered.length} match · ${entries.length} in corpus`}
        </Typography>
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 1, alignItems: "center" }}>
        <TextField
          size="small"
          label="text search"
          placeholder="matches claim text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 240 }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          label="topic search"
          placeholder="tag, entity, or kind"
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          sx={{ width: 240 }}
          InputLabelProps={{ shrink: true }}
        />
      </Box>

      <Tabs
        value={kindFilter}
        onChange={(_, v) => setKindFilter(v as string)}
        sx={{ mb: 1 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab value="" label={`all (${beforeKind.length} / ${entries.length})`} />
        {(["empirical", "historical", "speculative", "opinion", "definitional"] as const).map((k) => {
          const c = kindCounts[k] ?? { matched: 0, total: 0 };
          return <Tab key={k} value={k} label={`${k} (${c.matched} / ${c.total})`} />;
        })}
      </Tabs>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 50 }}>sort by:</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sort}
          onChange={(_, v) => v && setSort(v)}
        >
          <ToggleButton value="certain">most certain</ToggleButton>
          <ToggleButton value="uncertain">most uncertain</ToggleButton>
          <ToggleButton value="contradicted">most contradicted</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {sorted.map((c) => {
        const contradictions = contradictionCount.get(c.id) ?? 0;
        const deps = depCounts.get(c.id) ?? { out: 0, in: 0 };
        return (
          <Box
            key={c.id}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
              mb: 1,
              cursor: "pointer",
              "&:hover": { backgroundColor: "action.hover" },
            }}
            onClick={() => nav(`/claim/${encodeURIComponent(c.id)}`)}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" label={c.kind} sx={{ fontSize: "0.7rem" }} />
              {c.hostStance && (
                <Chip
                  size="small"
                  label={`host: ${c.hostStance}`}
                  variant="outlined"
                  sx={{ fontSize: "0.7rem" }}
                />
              )}
              {c.inVerdictSection && (
                <Chip size="small" variant="outlined" label="verdict" sx={{ fontSize: "0.7rem" }} />
              )}
              <MuiLink
                component="button"
                variant="caption"
                onClick={(e) => { e.stopPropagation(); nav(`/video/${c.videoId}`); }}
              >
                {c.videoId}
              </MuiLink>
              {contradictions > 0 && (
                <Chip
                  size="small"
                  label={`⚠ ${contradictions} contradiction${contradictions > 1 ? "s" : ""}`}
                  color="warning"
                  variant="outlined"
                  sx={{ fontSize: "0.7rem" }}
                />
              )}
              {(deps.in > 0 || deps.out > 0) && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${deps.out} out · ${deps.in} in`}
                  sx={{ fontSize: "0.7rem" }}
                  title="outgoing / incoming dependencies"
                />
              )}
            </Stack>

            <Typography variant="body2" sx={{ mb: 0.5 }}>{c.text}</Typography>

            <Stack spacing={0.25} sx={{ mb: 0.5 }}>
              <TruthBar
                value={c.derivedTruth ?? c.directTruth ?? null}
                source={c.truthSource}
                label="truth"
              />
              <TruthBar value={c.confidence} label="confidence" />
            </Stack>

            {c.tags && c.tags.length > 0 && (
              <Box sx={{ mb: 0.5 }}>
                {c.tags.map((t) => (
                  <Typography
                    key={t}
                    component="span"
                    variant="caption"
                    sx={{ color: "text.secondary", mr: 0.5, fontFamily: "monospace" }}
                  >
                    #{t}
                  </Typography>
                ))}
              </Box>
            )}

            {c.entities.length > 0 && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                  entities:
                </Typography>
                {c.entities.slice(0, 6).map((k) => (
                  <Chip
                    key={k}
                    size="small"
                    variant="outlined"
                    clickable
                    label={k}
                    onClick={(e) => {
                      e.stopPropagation();
                      nav(`/entity/${encodeURIComponent(k)}`);
                    }}
                    sx={{ fontSize: "0.7rem" }}
                  />
                ))}
                {c.entities.length > 6 && (
                  <Typography variant="caption" color="text.secondary">
                    +{c.entities.length - 6} more
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Container>
  );
}

function truthValue(c: ClaimsIndexEntry): number | null {
  if (c.derivedTruth !== null && c.derivedTruth !== undefined) return c.derivedTruth;
  if (c.directTruth !== null && c.directTruth !== undefined) return c.directTruth;
  return null;
}
