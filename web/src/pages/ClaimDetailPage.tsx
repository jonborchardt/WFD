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
import { ClaimDetailCard } from "../components/ClaimDetailCard";
import {
  StancePanel,
} from "../components/ContradictionResultRow";
import { ContradictionMenu } from "../components/ContradictionMenu";
import { DepRow } from "../components/DepRow";
import {
  loadClaimsBundle, type ClaimsBundle,
} from "../components/facets/claims-duck";
import { PageLoading } from "../components/PageLoading";
import { beginLoad } from "../lib/loading";
import {
  fetchCatalog,
  fetchClaims,
  fetchClaimsIndex,
  fetchConsonance,
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
//   - the claim itself (full ClaimDetailCard with evidence, deps, counterfactual)
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
  const [allAgreements, setAllAgreements] = useState<ClaimContradiction[] | null>(null);
  const [deps, setDeps] = useState<DependencyGraphFile | null>(null);
  const [bundle, setBundle] = useState<ClaimsBundle | null>(null);
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
      fetchConsonance().then((c) => setAllAgreements(c?.agreements ?? [])),
      fetchDependencyGraph().then(setDeps),
      loadClaimsBundle().then(setBundle),
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

  const agreementsForClaim = useMemo(
    () => (allAgreements ?? []).filter((c) => c.left === claimId || c.right === claimId),
    [allAgreements, claimId],
  );

  // Exclude "contradicts" — those already appear in the
  // Contradictions section above, with richer metadata (kind,
  // match reason, shared entities). Also drop self-edges so a
  // claim never shows up as its own dependency.
  const inbound = useMemo(() => {
    if (!deps || !claimId) return [];
    return deps.edges.filter((e) =>
      e.to === claimId && e.from !== claimId && e.kind !== "contradicts",
    );
  }, [deps, claimId]);

  const outbound = useMemo(() => {
    if (!deps || !claimId) return [];
    return deps.edges.filter((e) =>
      e.from === claimId && e.to !== claimId && e.kind !== "contradicts",
    );
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
        <ClaimDetailCard
          videoId={videoId}
          claim={claim}
          derivedTruth={indexEntry?.derivedTruth ?? null}
          truthSource={indexEntry?.truthSource}
          overrideRationale={indexEntry?.overrideRationale}
          inboundDeps={inbound.map((e) => ({
            target: e.from,
            kind: e.kind,
            rationale: e.rationale,
          }))}
          contradictions={contradictionsForClaim}
          agreements={agreementsForClaim}
          counterEvidence={indexEntry?.counterEvidence}
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
            const otherClaim = bundle?.claimsById.get(otherId);
            const sharedCount = cx.sharedEntities?.length ?? 0;
            return (
              <Box
                key={i}
                sx={{
                  border: "1px solid", borderColor: "divider",
                  borderRadius: 1, p: 1.5, mb: 1.5,
                }}
              >
                {bundle && (
                  <StancePanel
                    claim={otherClaim}
                    id={otherId}
                    bundle={bundle}
                    nav={nav}
                  />
                )}
                <Stack direction="row" spacing={1} sx={{
                  mt: 1, opacity: 0.7, flexWrap: "wrap", alignItems: "center",
                  color: "text.secondary",
                }}>
                  <Typography variant="caption" sx={{
                    fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
                  }}>
                    {cx.kind}
                  </Typography>
                  {cx.matchReason && (
                    <Typography variant="caption">· via {cx.matchReason}</Typography>
                  )}
                  {sharedCount > 0 && (
                    <Typography variant="caption">· {sharedCount} shared</Typography>
                  )}
                  {cx.similarity !== undefined && (
                    <Typography variant="caption">
                      · jaccard {cx.similarity.toFixed(2)}
                    </Typography>
                  )}
                  {(cx.sharedEntities ?? []).slice(0, 4).map((e) => (
                    <Chip
                      key={e} size="small" variant="outlined" clickable
                      label={e}
                      onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
                      sx={{ fontSize: 10, height: 20 }}
                    />
                  ))}
                  {sharedCount > 4 && (
                    <Typography variant="caption">
                      +{sharedCount - 4} more
                    </Typography>
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  <ContradictionMenu
                    leftId={cx.left}
                    rightId={cx.right}
                    isCustom={cx.kind === "manual"}
                    onMutated={refresh}
                  />
                </Stack>
              </Box>
            );
          })}
        </Paper>
      )}

      {/* Cross-video agreements (consonance). Same shape as
          contradictions but read-only and tinted as corroboration. */}
      {agreementsForClaim.length > 0 && (
        <Paper sx={{ mt: 3, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Cross-video agreements{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              {agreementsForClaim.length} corroborating this claim
            </Typography>
          </Typography>
          {agreementsForClaim.map((cx, i) => {
            const otherId = cx.left === claimId ? cx.right : cx.left;
            const otherClaim = bundle?.claimsById.get(otherId);
            const sharedCount = cx.sharedEntities?.length ?? 0;
            return (
              <Box
                key={i}
                sx={{
                  border: "1px solid", borderColor: "success.light",
                  borderRadius: 1, p: 1.5, mb: 1.5,
                }}
              >
                {bundle && (
                  <StancePanel
                    claim={otherClaim}
                    id={otherId}
                    bundle={bundle}
                    nav={nav}
                  />
                )}
                <Stack direction="row" spacing={1} sx={{
                  mt: 1, opacity: 0.8, flexWrap: "wrap", alignItems: "center",
                  color: "text.secondary",
                }}>
                  <Typography variant="caption" sx={{
                    fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
                    color: "success.main",
                  }}>
                    same claim
                  </Typography>
                  {cx.matchReason && (
                    <Typography variant="caption">· via {cx.matchReason}</Typography>
                  )}
                  {sharedCount > 0 && (
                    <Typography variant="caption">· {sharedCount} shared</Typography>
                  )}
                  {cx.similarity !== undefined && (
                    <Typography variant="caption">
                      · similarity {cx.similarity.toFixed(2)}
                    </Typography>
                  )}
                  {(cx.sharedEntities ?? []).slice(0, 4).map((e) => (
                    <Chip
                      key={e} size="small" variant="outlined" clickable
                      label={e}
                      onClick={() => nav(`/entity/${encodeURIComponent(e)}`)}
                      sx={{ fontSize: 10, height: 20 }}
                    />
                  ))}
                  {sharedCount > 4 && (
                    <Typography variant="caption">
                      +{sharedCount - 4} more
                    </Typography>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Paper>
      )}

      {/* Non-contradictory related claims: supports, presupposes,
          and elaborates. Contradicts is shown above in its own box. */}
      {(inbound.length > 0 || outbound.length > 0) && (
        <Paper sx={{ mt: 3, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Non-contradictory related claims{" "}
            <Typography component="span" variant="caption" color="text.secondary">
              {relatedCountLabel([...outbound, ...inbound])}
            </Typography>
          </Typography>
          {outbound.map((e, i) => (
            <DepRow
              key={`out-${i}`}
              direction="out"
              kind={e.kind}
              targetId={e.to}
              corpusIndex={corpusIndex}
              onClick={() => nav(`/claim/${encodeURIComponent(e.to)}`)}
            />
          ))}
          {inbound.map((e, i) => (
            <DepRow
              key={`in-${i}`}
              direction="in"
              kind={e.kind}
              targetId={e.from}
              corpusIndex={corpusIndex}
              onClick={() => nav(`/claim/${encodeURIComponent(e.from)}`)}
            />
          ))}
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
          onClick={() => nav(`/argument-map?kind=claim&q=${encodeURIComponent(claimId)}`)}
        >
          explore in argument map
        </Button>
      </Stack>
    </Container>
  );
}

// Build the "N supporting · M presupposing · K elaborating" line
// shown under the Related claims heading. Directions collapsed
// because the row cards already show direction per entry.
function relatedCountLabel(edges: Array<{ kind: string }>): string {
  const counts: Record<string, number> = {};
  for (const e of edges) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const parts: string[] = [];
  const add = (kind: string, word: string) => {
    const n = counts[kind] ?? 0;
    if (n > 0) parts.push(`${n} ${word}`);
  };
  add("supports", "supporting");
  add("presupposes", "presupposing");
  add("elaborates", "elaborating");
  return parts.join(" · ");
}
