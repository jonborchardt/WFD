import { useMemo, useState } from "react";
import { Box, Chip, Slider, Typography, Link, Collapse, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { TruthBar } from "./TruthBar";
import { ClaimMenu } from "./ClaimMenu";
import { entityChipSx } from "../lib/facet-helpers";
import { deepLink, fmtTimestamp } from "../lib/format";
import { truthColor } from "../lib/truth-palette";
import { runCounterfactual, type CounterfactualResult } from "../lib/counterfactual";
import type {
  Claim,
  ClaimContradiction,
  ClaimDependency,
  ClaimsIndexEntry,
  TruthSource,
} from "../types";

const KIND_COLOR: Record<string, string> = {
  empirical: "#1976d2",
  historical: "#6d4c41",
  speculative: "#8e24aa",
  opinion: "#ef6c00",
  definitional: "#00838f",
};

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

export function ClaimRow({
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
    const full = runCounterfactual(corpusIndex, claim.id, assumed);
    setCfPinned(assumed);
    setCfResult({ ...full, rows: full.rows.slice(0, 10) });
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

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        mb: 1,
        position: "relative",
      }}
      id={`claim-${claim.id}`}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap" }}>
        <Chip
          size="small"
          label={claim.kind}
          sx={{
            backgroundColor: KIND_COLOR[claim.kind] ?? "#757575",
            color: "white",
            fontSize: "0.7rem",
          }}
        />
        {claim.hostStance && (
          <Chip
            size="small"
            label={`host: ${claim.hostStance}`}
            variant="outlined"
            sx={{ fontSize: "0.7rem" }}
          />
        )}
        {claim.inVerdictSection && (
          <Chip size="small" label="verdict" variant="outlined" sx={{ fontSize: "0.7rem" }} />
        )}
        {contradictions && contradictions.length > 0 && (
          <Chip
            size="small"
            label={`⚠ ${contradictions.length} contradiction${contradictions.length > 1 ? "s" : ""}`}
            color="warning"
            variant="outlined"
            sx={{ fontSize: "0.7rem" }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
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
      </Stack>

      <Typography variant="body2" sx={{ mb: 1 }}>
        {claim.text}
      </Typography>

      <Stack spacing={0.25}>
        <TruthBar value={truthValue} source={source} label="truth" />
        <TruthBar value={claim.confidence} label="confidence" />
      </Stack>

      {overrideRationale && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          override: {overrideRationale}
        </Typography>
      )}

      {claim.tags && claim.tags.length > 0 && (
        <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {claim.tags.map((t) => (
            <Typography
              key={t}
              variant="caption"
              sx={{ color: "text.secondary", fontFamily: "monospace" }}
            >
              #{t}
            </Typography>
          ))}
        </Box>
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
            <Box sx={{ mt: 0.5, pl: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5, borderLeft: "2px solid", borderColor: "divider" }}>
              {(claim.dependencies ?? []).map((d, i) => (
                <Chip
                  key={`out-${i}`}
                  size="small"
                  variant="outlined"
                  clickable
                  label={`${d.kind} → ${shortId(d.target)}`}
                  onClick={() => scrollToClaim(d.target)}
                  sx={{ fontSize: "0.7rem" }}
                />
              ))}
              {(inboundDeps ?? []).map((d, i) => (
                <Chip
                  key={`in-${i}`}
                  size="small"
                  variant="outlined"
                  clickable
                  label={`${d.target ? shortId(d.target) : "?"} ${d.kind} → this`}
                  onClick={() => scrollToClaim(d.target)}
                  sx={{ fontSize: "0.7rem", opacity: 0.75 }}
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
                    { value: expectedTruth, label: "expected" },
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
              {cfResult !== null && cfResult.visibleCount === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {cfResult.smallShiftCount > 0
                    ? `${cfResult.smallShiftCount} dependent claim${cfResult.smallShiftCount > 1 ? "s" : ""} shifted by less than 0.005 under pin ${cfPinned?.toFixed(2)} — the dependency is heavily diluted by other anchors.`
                    : `pinning to ${cfPinned?.toFixed(2)} produced no shift in any dependent claim — their own anchors (or other supporting claims) dominate the blend.`}
                </Typography>
              )}
              {cfResult !== null && cfResult.visibleCount > 0 && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                    top {cfResult.rows.length} shift{cfResult.rows.length > 1 ? "s" : ""} under pin {cfPinned?.toFixed(2)}
                    {cfResult.smallShiftCount > 0 &&
                      ` · ${cfResult.smallShiftCount} smaller shift${cfResult.smallShiftCount > 1 ? "s" : ""} not shown`}
                    :
                  </Typography>
                  {cfResult.rows.map((r) => (
                    <Box key={r.id} sx={{ display: "flex", gap: 1, alignItems: "center", py: 0.25 }}>
                      <Typography variant="caption" sx={{ width: 72, fontFamily: "monospace", color: r.delta > 0 ? "success.main" : "error.main" }}>
                        {(r.delta > 0 ? "+" : "") + r.delta.toFixed(2)}
                      </Typography>
                      <Typography variant="caption" sx={{ flexGrow: 1, cursor: "pointer" }} onClick={() => scrollToClaim(r.id)}>
                        {r.text.length > 80 ? r.text.slice(0, 80) + "…" : r.text}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.baseline === null ? "—" : r.baseline.toFixed(2)} → {r.counterfactual.toFixed(2)}
                        {r.appeared && " (newly derived)"}
                      </Typography>
                    </Box>
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

function shortId(id: string): string {
  const i = id.lastIndexOf(":");
  return i > 0 ? id.slice(i + 1) : id;
}

function scrollToClaim(id: string): void {
  const el = document.getElementById(`claim-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}
