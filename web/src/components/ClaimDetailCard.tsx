import { useMemo, useState } from "react";
import { Box, Chip, Slider, Typography, Link, Collapse, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { TruthBar } from "./TruthBar";
import { ClaimMenu } from "./ClaimMenu";
import { DepRow } from "./DepRow";
import { entityChipSx } from "../lib/facet-helpers";
import { deepLink, fmtTimestamp } from "../lib/format";
import { truthColor, truthSideColor } from "../lib/truth-palette";
import { claimKindColor } from "../theme";
import {
  runCounterfactual,
  type CounterfactualResult,
  type CounterfactualRow,
} from "../lib/counterfactual";
import type {
  Claim,
  ClaimContradiction,
  ClaimDependency,
  ClaimsIndexEntry,
  TruthSource,
} from "../types";

interface Props {
  videoId: string;
  claim: Claim;
  // Derived fields supplied by the parent if the corpus index has been
  // loaded. Optional — the per-video file alone is enough to render a row.
  derivedTruth?: number | null;
  truthSource?: TruthSource;
  overrideRationale?: string;
  // Inbound deps (claims that depend on this one). Outbound deps live on
  // the claim itself.
  inboundDeps?: ClaimDependency[];
  // Contradiction records that reference this claim on either side.
  contradictions?: ClaimContradiction[];
  // Full corpus index, needed only for the counterfactual toggle. When
  // omitted the toggle is hidden.
  corpusIndex?: ClaimsIndexEntry[];
  // Called after any admin mutation so the parent can refresh the
  // relevant slice of data (replaces the old window.location.reload).
  onMutated?: () => void;
}

export function ClaimDetailCard({
  videoId,
  claim,
  derivedTruth,
  truthSource,
  overrideRationale,
  inboundDeps,
  contradictions,
  corpusIndex,
  onMutated,
}: Props) {
  const nav = useNavigate();
  const [showWhy, setShowWhy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showEntities, setShowEntities] = useState(false);
  const [showDeps, setShowDeps] = useState(false);

  // Counterfactual state has three situations we need to distinguish:
  //   1. closed — panel isn't open yet
  //   2. open, nothing run yet — show the "pick a value" hint
  //   3. open, just ran — show results (which may be empty if the
  //      claim has no dependents in the claim graph)
  // Previously (1) and (3 with empty rows) shared the same state and the
  // buttons looked dead on claims without dependents.
  // Expected truth for this claim — the baseline the slider starts at
  // so the user is nudging away from the status quo, not from an
  // arbitrary 0.5. Falls back to 0.5 when nothing is known.
  const expectedTruth =
    derivedTruth ?? claim.directTruth ?? 0.5;

  const [cfOpen, setCfOpen] = useState(false);
  const [cfResult, setCfResult] = useState<CounterfactualResult | null>(null);
  const [cfPinned, setCfPinned] = useState<number | null>(null);
  // Live slider position — drives the color swatch and label while the
  // user is still dragging. We only run the (cheap but not free)
  // propagation on the committed value via onChangeCommitted.
  const [cfDraft, setCfDraft] = useState<number>(expectedTruth);

  // Pinning this claim's truth only moves other claims' derived truth
  // when something in the graph actually reads from it. Two paths make
  // that happen:
  //   1. This claim has an outgoing `supports` or `contradicts` dep on
  //      another claim — the target gets pulled/pushed by this claim's
  //      value during propagation.
  //   2. Some OTHER claim in the corpus `presupposes` this claim — the
  //      presupposer's min-cap reads from this claim's value.
  // If neither is true, the counterfactual toggle would always yield an
  // empty result, so we hide it (with a hint) rather than offer a
  // control that silently does nothing.
  const hasDependents = useMemo(() => {
    const outgoing = (claim.dependencies ?? []).some(
      (d) =>
        d.target !== claim.id &&
        (d.kind === "supports" || d.kind === "contradicts"),
    );
    if (outgoing) return true;
    if (!corpusIndex) return false;
    return corpusIndex.some((c) =>
      (c.dependencies ?? []).some(
        (d) => d.target === claim.id && d.kind === "presupposes",
      ),
    );
  }, [claim.id, claim.dependencies, corpusIndex]);

  function runCf(assumed: number) {
    if (!corpusIndex) return;
    // Always keep the dependency neighborhood visible, even when those
    // claims didn't shift — runCounterfactual will emit unchanged rows
    // for any id in this set.
    const neighborIds = new Set<string>();
    for (const d of claim.dependencies ?? []) neighborIds.add(d.target);
    for (const d of inboundDeps ?? []) neighborIds.add(d.target);
    const full = runCounterfactual(corpusIndex, claim.id, assumed, {
      includeIds: neighborIds,
    });
    setCfPinned(assumed);
    setCfResult({ ...full, rows: full.rows.slice(0, 20) });
  }

  function toggleCf() {
    if (cfOpen) {
      setCfOpen(false);
      setCfResult(null);
      setCfPinned(null);
    } else {
      setCfOpen(true);
      // Reset the draft slider to the expected value each time the
      // panel opens so a revisit starts from the same sensible default.
      setCfDraft(expectedTruth);
    }
  }

  const truthValue =
    truthSource === "override" || derivedTruth !== null && derivedTruth !== undefined
      ? derivedTruth
      : claim.directTruth;
  const source: TruthSource =
    truthSource ??
    (claim.directTruth !== null && claim.directTruth !== undefined
      ? "direct"
      : "uncalibrated");

  const kColor = claimKindColor(claim.kind);

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderLeft: `5px solid ${truthSideColor(truthValue ?? null)}`,
        borderRadius: 1,
        p: 1.5,
        mb: 1,
        position: "relative",
      }}
      id={`claim-${claim.id}`}
    >
      <Box sx={{
        position: "absolute", top: 8, right: 8,
      }}>
        <ClaimMenu
          claim={{
            id: claim.id,
            videoId: claim.videoId,
            text: claim.text,
            directTruth: claim.directTruth ?? null,
            kind: claim.kind,
            hostStance: claim.hostStance ?? null,
            rationale: claim.rationale,
            tags: claim.tags,
          }}
          hasOverride={truthSource === "override"}
          onMutated={onMutated}
        />
      </Box>

      <Typography variant="body1" sx={{ mb: 1, fontWeight: 500, pr: 4 }}>
        {claim.text}
      </Typography>

      <Box sx={{ mb: 0.75 }}>
        <TruthBar value={truthValue} source={source} label="truth" width={200} />
      </Box>

      <Stack direction="row" spacing={1} sx={{
        mb: 0.75, color: "text.secondary",
        alignItems: "center", flexWrap: "wrap",
      }}>
        <Typography variant="caption" sx={{
          color: kColor, fontWeight: 700, letterSpacing: 0.5,
          textTransform: "uppercase", fontSize: 10,
        }}>
          {claim.kind}
        </Typography>
        {claim.hostStance && (
          <Typography variant="caption">· host {claim.hostStance}</Typography>
        )}
        {claim.inVerdictSection && (
          <Typography variant="caption">· verdict</Typography>
        )}
        {contradictions && contradictions.length > 0 && (
          <Typography variant="caption" sx={{ color: "warning.main" }}>
            · ⚠ {contradictions.length} contradiction
            {contradictions.length > 1 ? "s" : ""}
          </Typography>
        )}
        {claim.confidence != null && (
          <Typography variant="caption">
            · conf {claim.confidence.toFixed(2)}
          </Typography>
        )}
      </Stack>

      {overrideRationale && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          override: {overrideRationale}
        </Typography>
      )}

      {claim.entities.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Link
            component="button"
            variant="caption"
            onClick={() => setShowEntities((v) => !v)}
            underline="hover"
          >
            {showEntities ? "▾" : "▸"} entities ({claim.entities.length})
          </Link>
          <Collapse in={showEntities}>
            <Box sx={{ mt: 0.5, pl: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5, borderLeft: "2px solid", borderColor: "divider" }}>
              {claim.entities.map((k) => (
                <Chip
                  key={k}
                  size="small"
                  variant="outlined"
                  clickable
                  label={k}
                  onClick={() => nav(`/entity/${encodeURIComponent(k)}`)}
                  sx={{ fontSize: "0.7rem", ...entityChipSx(k) }}
                />
              ))}
            </Box>
          </Collapse>
        </Box>
      )}

      <Box sx={{ mt: 1 }}>
        <Link
          component="button"
          variant="caption"
          onClick={() => setShowEvidence((v) => !v)}
          underline="hover"
        >
          {showEvidence ? "▾" : "▸"} evidence ({claim.evidence.length})
        </Link>
        <Collapse in={showEvidence}>
          <Box sx={{ mt: 0.5, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
            {claim.evidence.map((ev, i) => (
              <Box key={i} sx={{ mb: 0.75 }}>
                <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                  “{ev.quote}”
                </Typography>
                <Link
                  href={deepLink(videoId, ev.timeStart)}
                  target="_blank"
                  rel="noopener"
                  variant="caption"
                >
                  [{fmtTimestamp(ev.timeStart)}]
                </Link>
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>

      {((claim.dependencies && claim.dependencies.length > 0) ||
        (inboundDeps && inboundDeps.length > 0)) && (
        <Box sx={{ mt: 0.75 }}>
          <Link
            component="button"
            variant="caption"
            onClick={() => setShowDeps((v) => !v)}
            underline="hover"
          >
            {showDeps ? "▾" : "▸"} deps ({(claim.dependencies?.length ?? 0) + (inboundDeps?.length ?? 0)})
          </Link>
          <Collapse in={showDeps}>
            <Box sx={{ mt: 0.5, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
              {(claim.dependencies ?? []).map((d, i) => (
                <DepRow
                  key={`out-${i}`}
                  direction="out"
                  kind={d.kind}
                  targetId={d.target}
                  corpusIndex={corpusIndex}
                  onClick={() => scrollToClaim(d.target)}
                />
              ))}
              {(inboundDeps ?? []).map((d, i) => (
                <DepRow
                  key={`in-${i}`}
                  direction="in"
                  kind={d.kind}
                  targetId={d.target}
                  corpusIndex={corpusIndex}
                  onClick={() => scrollToClaim(d.target)}
                />
              ))}
            </Box>
          </Collapse>
        </Box>
      )}

      <Box sx={{ mt: 0.75 }}>
        <Link
          component="button"
          variant="caption"
          onClick={() => setShowWhy((v) => !v)}
          underline="hover"
        >
          {showWhy ? "▾" : "▸"} why?
        </Link>
        <Collapse in={showWhy}>
          <Box sx={{ mt: 0.5, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
            <Typography variant="body2" color="text.secondary">
              {claim.rationale}
            </Typography>
          </Box>
        </Collapse>
      </Box>

      {contradictions && contradictions.length > 0 && (
        <Box sx={{ mt: 0.75, pl: 1.5, borderLeft: "2px solid", borderColor: "warning.light" }}>
          {contradictions.map((c, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{ display: "block" }}>
              ⚠ {c.summary}
            </Typography>
          ))}
        </Box>
      )}

      {corpusIndex && corpusIndex.length > 0 && !hasDependents && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontStyle: "italic" }}>
          no dependent claims — counterfactual unavailable
        </Typography>
      )}
      {corpusIndex && corpusIndex.length > 0 && hasDependents && (
        <Box sx={{ mt: 0.75 }}>
          <Link
            component="button"
            variant="caption"
            underline="hover"
            onClick={toggleCf}
          >
            {cfOpen ? "▾" : "▸"} counterfactual — see how pinning this claim's truth moves the graph
          </Link>
          {cfOpen && (
            <Box sx={{ mt: 0.5, p: 1, backgroundColor: "action.hover", borderRadius: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                <Box
                  sx={{
                    width: 24,
                    height: 10,
                    borderRadius: 0.5,
                    background: truthColor(cfDraft),
                    flexShrink: 0,
                  }}
                />
                <Slider
                  size="small"
                  min={0}
                  max={1}
                  step={0.01}
                  value={cfDraft}
                  onChange={(_, v) => {
                    const n = Array.isArray(v) ? v[0] : v;
                    setCfDraft(n);
                    // Run propagation live on every change so the
                    // affected-claims list updates continuously while
                    // the user drags. Counterfactual cost is
                    // sub-millisecond at current corpus scale.
                    runCf(n);
                  }}
                  marks={[
                    { value: 0, label: "false" },
                    // Drop the "expected" text label when the mark is
                    // close to either endpoint; the two labels collide
                    // visually. The tick itself still renders.
                    {
                      value: expectedTruth,
                      label: expectedTruth > 0.2 && expectedTruth < 0.8
                        ? "expected" : undefined,
                    },
                    { value: 1, label: "true" },
                  ]}
                  sx={{ flex: 1, mx: 1 }}
                />
                <Typography variant="caption" sx={{ fontFamily: "monospace", minWidth: 42, textAlign: "right" }}>
                  {cfDraft.toFixed(2)}
                </Typography>
              </Box>
              {cfResult === null && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  drag the slider to pin this claim's truth and see which other claims shift. default is its expected value.
                </Typography>
              )}
              {cfResult !== null && cfResult.rows.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  no dependent claims in the graph to show.
                </Typography>
              )}
              {cfResult !== null && cfResult.rows.length > 0 && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{
                    display: "block", mb: 0.75,
                  }}>
                    {cfResult.visibleCount} shift
                    {cfResult.visibleCount === 1 ? "" : "s"} under pin
                    {" "}{cfPinned?.toFixed(2)}
                    {cfResult.rows.length > cfResult.visibleCount &&
                      ` · ${cfResult.rows.length - cfResult.visibleCount} unchanged`}
                    {cfResult.smallShiftCount > 0 &&
                      ` · ${cfResult.smallShiftCount} below 0.005 not shown`}
                  </Typography>
                  {cfResult.rows.map((r) => (
                    <CounterfactualRow key={r.id} row={r} />
                  ))}
                </>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function scrollToClaim(id: string): void {
  const el = document.getElementById(`claim-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function CounterfactualRow({ row }: { row: CounterfactualRow }) {
  const hasShift = Math.abs(row.delta) >= 0.005;
  const deltaColor =
    row.delta > 0 ? "success.main"
    : row.delta < 0 ? "error.main"
    : "text.disabled";
  return (
    <Box
      sx={{
        display: "flex", gap: 1, alignItems: "flex-start",
        py: 0.5, cursor: "pointer",
        "&:hover": { backgroundColor: "action.hover" },
        opacity: hasShift ? 1 : 0.65,
      }}
      onClick={() => scrollToClaim(row.id)}
    >
      <Stack spacing={0.25} sx={{ flexShrink: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{
            width: 30, fontSize: 9, letterSpacing: 0.5,
            textTransform: "uppercase", textAlign: "right",
          }}>
            was
          </Typography>
          <TruthBar
            value={row.baseline}
            label="truth"
            minLabelWidth={0}
          />
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{
            width: 30, fontSize: 9, letterSpacing: 0.5,
            textTransform: "uppercase", textAlign: "right",
          }}>
            now
          </Typography>
          <TruthBar
            value={row.counterfactual}
            label="truth"
            minLabelWidth={0}
          />
        </Stack>
      </Stack>
      <Typography variant="caption" sx={{
        width: 52, fontFamily: "monospace", color: deltaColor,
        textAlign: "right", mt: 0.25,
      }}>
        {hasShift
          ? (row.delta > 0 ? "+" : "") + row.delta.toFixed(2)
          : "—"}
      </Typography>
      <Typography variant="body2" sx={{
        flexGrow: 1, lineHeight: 1.35, minWidth: 0, mt: 0.25,
      }}>
        {truncate(row.text, 120)}
        {row.appeared && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            (newly derived)
          </Typography>
        )}
      </Typography>
    </Box>
  );
}
