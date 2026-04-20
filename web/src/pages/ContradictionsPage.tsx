import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Tab,
  Tabs,
  Chip,
  TextField,
  Stack,
} from "@mui/material";
import { fetchContradictions, fetchClaimsIndex } from "../lib/data";
import { TruthBar } from "../components/TruthBar";
import type {
  ClaimContradiction,
  ClaimsIndexEntry,
} from "../types";

type Kind = "pair" | "broken-presupposition" | "cross-video";

export function ContradictionsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ClaimContradiction[] | null>(null);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [claimsById, setClaimsById] = useState<Map<string, ClaimsIndexEntry>>(new Map());
  const [tab, setTab] = useState<Kind>("cross-video");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchContradictions().then((cx) => {
      setRows(cx?.contradictions ?? []);
      setByKind(cx?.byKind ?? {});
    });
    fetchClaimsIndex().then((idx) => {
      const m = new Map<string, ClaimsIndexEntry>();
      for (const c of idx?.claims ?? []) m.set(c.id, c);
      setClaimsById(m);
    });
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (c.kind !== tab) return false;
      if (!q) return true;
      const left = claimsById.get(c.left);
      const right = claimsById.get(c.right);
      return (
        c.summary.toLowerCase().includes(q) ||
        left?.text.toLowerCase().includes(q) ||
        right?.text.toLowerCase().includes(q) ||
        (c.sharedEntities ?? []).some((e) => e.toLowerCase().includes(q))
      );
    });
  }, [rows, tab, query, claimsById]);

  if (!rows) {
    return <Container sx={{ py: 3 }}><Typography>loading contradictions…</Typography></Container>;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Contradictions{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {rows.length} total
        </Typography>
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as Kind)}
        sx={{ mb: 2 }}
      >
        <Tab value="cross-video" label={`cross-video (${byKind["cross-video"] ?? 0})`} />
        <Tab value="pair" label={`pair (${byKind["pair"] ?? 0})`} />
        <Tab value="broken-presupposition" label={`broken presupp (${byKind["broken-presupposition"] ?? 0})`} />
      </Tabs>

      <TextField
        size="small"
        label="search text / entity"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 2, width: 360 }}
      />

      {filtered.length === 0 && (
        <Typography color="text.secondary">no contradictions match these filters.</Typography>
      )}

      {filtered.map((c, i) => {
        const left = claimsById.get(c.left);
        const right = claimsById.get(c.right);
        return (
          <Box
            key={i}
            sx={{
              border: "1px solid #e0e0e0",
              borderRadius: 1,
              p: 1.5,
              mb: 1.5,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
              <Chip size="small" label={c.kind} color="warning" />
              {c.similarity !== undefined && (
                <Chip size="small" variant="outlined" label={`jaccard=${c.similarity.toFixed(2)}`} />
              )}
              {(c.sharedEntities ?? []).map((e) => (
                <Chip
                  key={e}
                  size="small"
                  variant="outlined"
                  label={e}
                  clickable
                  onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
                />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {c.summary}
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <ClaimCard claim={left} id={c.left} onClickVideo={(vid) => nav(`/video/${vid}#claim-${c.left}`)} />
              <ClaimCard claim={right} id={c.right} onClickVideo={(vid) => nav(`/video/${vid}#claim-${c.right}`)} />
            </Stack>
          </Box>
        );
      })}
    </Container>
  );
}

interface ClaimCardProps {
  claim: ClaimsIndexEntry | undefined;
  id: string;
  onClickVideo: (videoId: string) => void;
}

function ClaimCard({ claim, id, onClickVideo }: ClaimCardProps) {
  if (!claim) {
    return (
      <Box sx={{ flex: 1, p: 1, backgroundColor: "#fafafa", borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">{id} (missing from index)</Typography>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        flex: 1,
        p: 1,
        border: "1px solid #eee",
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { backgroundColor: "#fafafa" },
      }}
      onClick={() => onClickVideo(claim.videoId)}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center", flexWrap: "wrap" }}>
        <Chip size="small" label={claim.kind} sx={{ fontSize: "0.7rem" }} />
        {claim.hostStance && (
          <Chip size="small" variant="outlined" label={`host: ${claim.hostStance}`} sx={{ fontSize: "0.7rem" }} />
        )}
        <Typography variant="caption" color="text.secondary">{claim.videoId}</Typography>
      </Stack>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{claim.text}</Typography>
      <TruthBar
        value={claim.derivedTruth ?? claim.directTruth ?? null}
        source={claim.truthSource}
        label="truth"
      />
    </Box>
  );
}
