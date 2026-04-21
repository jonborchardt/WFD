import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Chip,
  Container,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { ClaimRow } from "../components/ClaimRow";
import { TruthBar } from "../components/TruthBar";
import { ContradictionMenu } from "../components/ContradictionMenu";
import { PageLoading } from "../components/PageLoading";
import { beginLoad } from "../lib/loading";
import {
  fetchCatalog,
  fetchClaims,
  fetchClaimsIndex,
  fetchContradictions,
  fetchDependencyGraph,
  invalidateClaimsCaches,
} from "../lib/data";
import type {
  Claim,
  ClaimContradiction,
  ClaimsIndexEntry,
  DependencyGraphFile,
  PersistedClaims,
  VideoRow,
} from "../types";

// Per-claim landing page. Linked from /claims and from claim-graph
// double-clicks. Shows:
//   - the claim itself (full ClaimRow with evidence, deps, counterfactual)
//   - every contradiction that touches this claim (both sides)
//   - the 1-hop dependency neighborhood (dependencies + dependents)
//   - a link to open the wider claim-graph seeded on this claim
// Video context (title, channel) is rendered up top; a "open on video
// page" affordance is always visible.
export function ClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>();
  const nav = useNavigate();

  const [videoRow, setVideoRow] = useState<VideoRow | null>(null);
  const [perVideo, setPerVideo] = useState<PersistedClaims | null>(null);
  const [corpusIndex, setCorpusIndex] = useState<ClaimsIndexEntry[] | null>(null);
  const [allContradictions, setAllContradictions] = useState<ClaimContradiction[] | null>(null);
  const [deps, setDeps] = useState<DependencyGraphFile | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const refresh = () => {
    invalidateClaimsCaches();
    setReloadTick((t) => t + 1);
  };

  const videoId = useMemo(() => {
    if (!claimId) return "";
    const colon = claimId.indexOf(":");
    return colon > 0 ? claimId.slice(0, colon) : "";
  }, [claimId]);

  useEffect(() => {
    if (!claimId || !videoId) return;
    const endLoad = beginLoad();
    Promise.allSettled([
      fetchCatalog().then((rows) => setVideoRow(rows.find((r) => r.videoId === videoId) ?? null)),
      fetchClaims(videoId).then(setPerVideo),
      fetchClaimsIndex().then((idx) => setCorpusIndex(idx?.claims ?? [])),
      fetchContradictions().then((cx) => setAllContradictions(cx?.contradictions ?? [])),
      fetchDependencyGraph().then(setDeps),
    ]).finally(endLoad);
  }, [claimId, videoId, reloadTick]);

  // The Claim record from the per-video file (full evidence / rationale).
  const claim: Claim | null = useMemo(() => {
    if (!perVideo) return null;
    return perVideo.claims.find((c) => c.id === claimId) ?? null;
  }, [perVideo, claimId]);

  const indexEntry: ClaimsIndexEntry | null = useMemo(() => {
    if (!corpusIndex || !claimId) return null;
    return corpusIndex.find((c) => c.id === claimId) ?? null;
  }, [corpusIndex, claimId]);

  const contradictionsForClaim = useMemo(
    () => (allContradictions ?? []).filter((c) => c.left === claimId || c.right === claimId),
    [allContradictions, claimId],
  );

  const inbound = useMemo(() => {
    if (!deps || !claimId) return [];
    return deps.edges.filter((e) => e.to === claimId);
  }, [deps, claimId]);

  const outbound = useMemo(() => {
    if (!deps || !claimId) return [];
    return deps.edges.filter((e) => e.from === claimId);
  }, [deps, claimId]);

  if (!claimId) {
    return (
      <Container sx={{ py: 3 }}>
        <Typography color="error">No claim id in URL.</Typography>
      </Container>
    );
  }
  if (!corpusIndex || !perVideo) {
    return <PageLoading label="loading claim…" />;
  }
  if (!claim) {
    return (
      <Container sx={{ py: 3 }}>
        <Typography color="error">
          Claim <code>{claimId}</code> not found.
        </Typography>
        <MuiLink component="button" onClick={() => nav(-1)}>← back</MuiLink>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button size="small" onClick={() => nav(-1)}>← back</Button>

      {/* Header: video context */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary">claim</Typography>
        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>{claimId}</Typography>
        <Typography variant="caption" color="text.secondary">in</Typography>
        <MuiLink component="button" variant="caption" onClick={() => nav(`/video/${videoId}`)}>
          {videoRow?.title ?? videoId}
        </MuiLink>
      </Stack>

      {/* The claim itself */}
      <Box sx={{ mt: 2 }}>
        <ClaimRow
          videoId={videoId}
          claim={{ ...claim, tags: indexEntry?.tags ?? claim.tags }}
          derivedTruth={indexEntry?.derivedTruth ?? null}
          truthSource={indexEntry?.truthSource}
          overrideRationale={indexEntry?.overrideRationale}
          inboundDeps={inbound.map((e) => ({
            target: e.from,
            kind: e.kind,
            rationale: e.rationale,
          }))}
          contradictions={contradictionsForClaim}
          corpusIndex={corpusIndex}
          onMutated={refresh}
        />
      </Box>

      {/* Contradictions section */}
      {contradictionsForClaim.length > 0 && (
        <Paper sx={{ mt: 3, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Contradictions{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              {contradictionsForClaim.length} involving this claim
            </Typography>
          </Typography>
          {contradictionsForClaim.map((cx, i) => {
            const otherId = cx.left === claimId ? cx.right : cx.left;
            const other = corpusIndex.find((c) => c.id === otherId);
            return (
              <Box
                key={i}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 1.5,
                  mb: 1,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                  <Chip size="small" color="warning" label={cx.kind} />
                  {cx.matchReason && (
                    <Chip size="small" variant="outlined" label={`via ${cx.matchReason}`} />
                  )}
                  {cx.similarity !== undefined && (
                    <Chip size="small" variant="outlined" label={`jaccard=${cx.similarity.toFixed(2)}`} />
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  <ContradictionMenu
                    leftId={cx.left}
                    rightId={cx.right}
                    isCustom={cx.kind === "manual"}
                    onMutated={refresh}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  {cx.summary}
                </Typography>
                {other ? (
                  <Box
                    sx={{
                      p: 1,
                      borderLeft: "3px solid",
                      borderColor: "warning.light",
                      backgroundColor: "action.hover",
                      cursor: "pointer",
                      "&:hover": { backgroundColor: "action.selected" },
                    }}
                    onClick={() => nav(`/claim/${encodeURIComponent(otherId)}`)}
                  >
                    <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center" }}>
                      <Chip size="small" label={other.kind} />
                      {other.hostStance && (
                        <Chip size="small" variant="outlined" label={`host: ${other.hostStance}`} />
                      )}
                      <Typography variant="caption" color="text.secondary">{other.videoId}</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>{other.text}</Typography>
                    <TruthBar
                      value={other.derivedTruth ?? other.directTruth ?? null}
                      source={other.truthSource}
                      label="truth"
                    />
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary">{otherId} (not in index)</Typography>
                )}
              </Box>
            );
          })}
        </Paper>
      )}

      {/* Dependency neighborhood */}
      {(inbound.length > 0 || outbound.length > 0) && (
        <Paper sx={{ mt: 3, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Dependencies{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              {outbound.length} outgoing · {inbound.length} incoming
            </Typography>
          </Typography>
          {outbound.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">this claim →</Typography>
              {outbound.map((e, i) => {
                const t = corpusIndex.find((c) => c.id === e.to);
                return (
                  <Box
                    key={`out-${i}`}
                    sx={{ pl: 1, my: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                    onClick={() => nav(`/claim/${encodeURIComponent(e.to)}`)}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{e.kind}</Typography>
                    {" "}
                    <Typography variant="caption" color="text.secondary">→ {t?.text ?? e.to}</Typography>
                  </Box>
                );
              })}
            </Box>
          )}
          {inbound.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">→ this claim</Typography>
              {inbound.map((e, i) => {
                const t = corpusIndex.find((c) => c.id === e.from);
                return (
                  <Box
                    key={`in-${i}`}
                    sx={{ pl: 1, my: 0.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                    onClick={() => nav(`/claim/${encodeURIComponent(e.from)}`)}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{e.kind}</Typography>
                    {" "}
                    <Typography variant="caption" color="text.secondary">← {t?.text ?? e.from}</Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </Paper>
      )}

      {/* Deep links */}
      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        <Button size="small" variant="outlined" onClick={() => nav(`/video/${videoId}#claim-${claimId}`)}>
          open on video page
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => nav(`/claim-graph?kind=claim&q=${encodeURIComponent(claimId)}`)}
        >
          explore in claim graph
        </Button>
      </Stack>
    </Container>
  );
}
