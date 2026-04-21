import { useCallback, useEffect, useMemo, useState } from "react";
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
  Tooltip,
} from "@mui/material";
import { fetchContradictions, fetchClaimsIndex, invalidateClaimsCaches } from "../lib/data";
import { TruthBar } from "../components/TruthBar";
import { ContradictionMenu } from "../components/ContradictionMenu";
import { PageLoading } from "../components/PageLoading";
import { matchesTopic } from "../lib/claim-search";
import { beginLoad } from "../lib/loading";
import type {
  ClaimContradiction,
  ClaimsIndexEntry,
} from "../types";

type Kind = "all" | "pair" | "broken-presupposition" | "cross-video" | "manual";

// Short explanations shown when the user hovers a tab.
const KIND_TOOLTIPS: Record<Kind, string> = {
  all: "every flagged contradiction across all kinds, filtered by the current text / topic / cross-video filters.",
  pair: "inside a single video: claim A has a `contradicts` edge pointing at claim B, and both are being asserted as true. The most direct kind of conflict.",
  "broken-presupposition": "claim A explicitly presupposes claim B, but the AI judged B to have low truth — so A is built on a shaky foundation.",
  "cross-video": "claims from different videos that share entities and have opposite host stances (asserts vs denies). Noisier; use the match-reason filter to narrow.",
  manual: "contradictions an admin added by hand (the detector missed them), or that operator review has promoted from a suggestion.",
};

export function ContradictionsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ClaimContradiction[] | null>(null);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [claimsById, setClaimsById] = useState<Map<string, ClaimsIndexEntry>>(new Map());
  const [tab, setTab] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState<"" | "jaccard" | "strong-overlap">("");
  const [minShared, setMinShared] = useState(0);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    const endLoad = beginLoad();
    Promise.allSettled([
      fetchContradictions().then((cx) => {
        setRows(cx?.contradictions ?? []);
        setByKind(cx?.byKind ?? {});
      }),
      fetchClaimsIndex().then((idx) => {
        const m = new Map<string, ClaimsIndexEntry>();
        for (const c of idx?.claims ?? []) m.set(c.id, c);
        setClaimsById(m);
      }),
    ]).finally(endLoad);
  }, [reloadTick]);
  const onMutated = () => { invalidateClaimsCaches(); setReloadTick((t) => t + 1); };

  // Filter rules that apply across every tab. Run once so we can display
  // per-tab counts for the currently-active filter set.
  const universalPass = useCallback((c: ClaimContradiction) => {
    const q = query.trim().toLowerCase();
    const left = claimsById.get(c.left);
    const right = claimsById.get(c.right);
    if (tagQuery.trim()) {
      const lHit = left ? matchesTopic(left, tagQuery) : false;
      const rHit = right ? matchesTopic(right, tagQuery) : false;
      if (!lHit && !rHit) return false;
    }
    // Cross-video-only filters apply only to cross-video rows; other
    // kinds (pair, broken-presupposition, manual) pass through so the
    // same filter bar works uniformly.
    if (c.kind === "cross-video") {
      if (reasonFilter && c.matchReason !== reasonFilter) return false;
      if (minShared > 0 && (c.sharedEntities?.length ?? 0) < minShared) return false;
    }
    if (!q) return true;
    return (
      c.summary.toLowerCase().includes(q) ||
      left?.text.toLowerCase().includes(q) ||
      right?.text.toLowerCase().includes(q) ||
      (c.sharedEntities ?? []).some((e) => e.toLowerCase().includes(q))
    );
  }, [query, tagQuery, reasonFilter, minShared, claimsById]);

  // Per-tab row counts under the current filter set.
  const filteredByKind = useMemo(() => {
    const out: Record<string, number> = {};
    if (!rows) return out;
    for (const c of rows) {
      if (!universalPass(c)) continue;
      out[c.kind] = (out[c.kind] ?? 0) + 1;
    }
    return out;
  }, [rows, universalPass]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((c) => (tab === "all" || c.kind === tab) && universalPass(c));
  }, [rows, tab, universalPass]);

  if (!rows) {
    return <PageLoading label="loading contradictions…" hint="fetching contradictions and claim index" />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Contradictions{" "}
        <Typography component="span" variant="caption" color="text.secondary">
          {rows.length} total
        </Typography>
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          size="small"
          label="text search"
          placeholder="summary, either claim, or shared entity"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 280 }}
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
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip
            arrow
            title={
              <Box>
                <Typography variant="caption" sx={{ display: "block" }}>
                  <strong>cross-video match:</strong> how the detector decided these two
                  claims are on the same topic.
                </Typography>
                <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                  <strong>jaccard</strong> — the two claim texts share enough tokens
                  (word-level similarity ≥ 0.10). Stronger signal; usually the same
                  proposition phrased two ways.
                </Typography>
                <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                  <strong>strong-overlap</strong> — text similarity was weak but the
                  claims share ≥2 entity keys. Noisier path; we only flag when one
                  side explicitly asserts what the other denies.
                </Typography>
              </Box>
            }
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textDecoration: "underline dotted", cursor: "help" }}
            >
              cross-video match:
            </Typography>
          </Tooltip>
          {(["", "jaccard", "strong-overlap"] as const).map((r) => (
            <Chip
              key={r || "all"}
              size="small"
              label={r || "all"}
              color={reasonFilter === r ? "primary" : "default"}
              variant={reasonFilter === r ? "filled" : "outlined"}
              onClick={() => setReasonFilter(r)}
              clickable
            />
          ))}
        </Stack>
        <Tooltip
          arrow
          title="Require at least this many shared entity keys between the two claims. 0 = no filter. Raising this reduces noise from tangential co-mentions (e.g. both claims mention the CIA but discuss different events)."
        >
          <TextField
            size="small"
            type="number"
            label="min shared entities"
            value={minShared}
            onChange={(e) => setMinShared(Math.max(0, Number(e.target.value) | 0))}
            sx={{ width: 150 }}
            inputProps={{ min: 0, max: 10 }}
            InputLabelProps={{ shrink: true }}
          />
        </Tooltip>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as Kind)}
        sx={{ mb: 2 }}
      >
        <Tab
          value="all"
          label={`all (${Object.values(filteredByKind).reduce((a, b) => a + b, 0)} / ${rows.length})`}
          title={KIND_TOOLTIPS.all}
        />
        <Tab
          value="cross-video"
          label={`cross-video (${filteredByKind["cross-video"] ?? 0} / ${byKind["cross-video"] ?? 0})`}
          title={KIND_TOOLTIPS["cross-video"]}
        />
        <Tab
          value="pair"
          label={`pair (${filteredByKind["pair"] ?? 0} / ${byKind["pair"] ?? 0})`}
          title={KIND_TOOLTIPS.pair}
        />
        <Tab
          value="broken-presupposition"
          label={`broken presupp (${filteredByKind["broken-presupposition"] ?? 0} / ${byKind["broken-presupposition"] ?? 0})`}
          title={KIND_TOOLTIPS["broken-presupposition"]}
        />
        <Tab
          value="manual"
          label={`manual (${filteredByKind["manual"] ?? 0} / ${byKind["manual"] ?? 0})`}
          title={KIND_TOOLTIPS.manual}
        />
      </Tabs>

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
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
              mb: 1.5,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
              <Chip size="small" label={c.kind} color="warning" />
              {c.matchReason && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`via ${c.matchReason}`}
                  color={c.matchReason === "strong-overlap" ? "default" : "info"}
                  title={c.matchReason === "strong-overlap"
                    ? "matched by shared-entity count — text similarity was weak; may be noisier"
                    : "matched by text similarity (jaccard)"}
                />
              )}
              {(c.sharedEntities?.length ?? 0) > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${c.sharedEntities!.length} shared`}
                />
              )}
              {c.similarity !== undefined && (
                <Chip size="small" variant="outlined" label={`jaccard=${c.similarity.toFixed(2)}`} />
              )}
              {(c.sharedEntities ?? []).slice(0, 4).map((e) => (
                <Chip
                  key={e}
                  size="small"
                  variant="outlined"
                  label={e}
                  clickable
                  onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
                />
              ))}
              {(c.sharedEntities?.length ?? 0) > 4 && (
                <Typography variant="caption" color="text.secondary">
                  +{c.sharedEntities!.length - 4} more
                </Typography>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <ContradictionMenu
                leftId={c.left}
                rightId={c.right}
                isCustom={c.kind === "manual"}
                onMutated={onMutated}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {c.summary}
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <ClaimCard claim={left} id={c.left} onOpen={() => nav(`/claim/${encodeURIComponent(c.left)}`)} />
              <ClaimCard claim={right} id={c.right} onOpen={() => nav(`/claim/${encodeURIComponent(c.right)}`)} />
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
  onOpen: () => void;
}

function ClaimCard({ claim, id, onOpen }: ClaimCardProps) {
  if (!claim) {
    return (
      <Box sx={{ flex: 1, p: 1, backgroundColor: "action.hover", borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">{id} (missing from index)</Typography>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        flex: 1,
        p: 1,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { backgroundColor: "action.hover" },
      }}
      onClick={onOpen}
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
