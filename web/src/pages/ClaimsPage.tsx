import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Link as MuiLink,
} from "@mui/material";
import {
  fetchClaimsIndex,
  fetchContradictions,
} from "../lib/data";
import { TruthBar } from "../components/TruthBar";
import type { ClaimsIndexEntry } from "../types";

type SortMode = "certain" | "uncertain" | "contradicted";

export function ClaimsPage() {
  const nav = useNavigate();
  const [entries, setEntries] = useState<ClaimsIndexEntry[] | null>(null);
  const [contradictionCount, setContradictionCount] = useState<Map<string, number>>(new Map());
  const [sort, setSort] = useState<SortMode>("certain");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchClaimsIndex().then((idx) => setEntries(idx?.claims ?? []));
    fetchContradictions().then((cx) => {
      const m = new Map<string, number>();
      for (const c of cx?.contradictions ?? []) {
        m.set(c.left, (m.get(c.left) ?? 0) + 1);
        m.set(c.right, (m.get(c.right) ?? 0) + 1);
      }
      setContradictionCount(m);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((c) => {
      if (kindFilter && c.kind !== kindFilter) return false;
      if (q && !c.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, kindFilter, query]);

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
    return <Container sx={{ py: 3 }}><Typography>loading claims…</Typography></Container>;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Claims{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {entries.length} in corpus · showing top {sorted.length}
        </Typography>
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 2, alignItems: "center" }}>
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

        <TextField
          size="small"
          label="search text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 240 }}
        />

        <ToggleButtonGroup
          size="small"
          exclusive
          value={kindFilter}
          onChange={(_, v) => setKindFilter(v ?? "")}
        >
          <ToggleButton value="">all</ToggleButton>
          <ToggleButton value="empirical">empirical</ToggleButton>
          <ToggleButton value="historical">historical</ToggleButton>
          <ToggleButton value="speculative">speculative</ToggleButton>
          <ToggleButton value="opinion">opinion</ToggleButton>
          <ToggleButton value="definitional">definitional</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {sorted.map((c) => {
        const contradictions = contradictionCount.get(c.id) ?? 0;
        return (
          <Box
            key={c.id}
            sx={{
              border: "1px solid #e0e0e0",
              borderRadius: 1,
              p: 1.5,
              mb: 1,
              cursor: "pointer",
              "&:hover": { backgroundColor: "#fafafa" },
            }}
            onClick={() => nav(`/video/${c.videoId}#claim-${c.id}`)}
          >
            <Box sx={{ display: "flex", gap: 1, mb: 0.5, flexWrap: "wrap", alignItems: "center" }}>
              <Chip size="small" label={c.kind} sx={{ fontSize: "0.7rem" }} />
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
                  label={`⚠ ${contradictions}`}
                  sx={{ backgroundColor: "#fff3e0", color: "#e65100", fontSize: "0.7rem" }}
                />
              )}
            </Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>{c.text}</Typography>
            <TruthBar
              value={c.derivedTruth ?? c.directTruth ?? null}
              source={c.truthSource}
              label="truth"
            />
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
