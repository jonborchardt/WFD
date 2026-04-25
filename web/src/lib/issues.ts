// GitHub issue URL generators.
//
// Each function builds an `issues/new` URL with a prefilled title, a
// structured markdown body, and issue labels. For edit-request issues
// the body also embeds an `http://localhost:4173/admin/apply?op=…`
// link: an admin running the local server can one-click accept the
// suggested change without retyping anything.
//
// Apply-link coverage (kept in sync with the `/admin/apply` handler
// in src/ui/server.ts):
//   delete / merge / display / video-merge / delete-relation
//   claim-truth-override / claim-field-override
//   dismiss-contradiction / custom-contradiction
// Graph-node, graph-edge, and generic-suggest issues are open-ended
// — they don't carry a single apply link because the requested
// action isn't known until the submitter describes it.

import type { GraphNode, GraphEdge } from "../types";

const CAPTIONS_ISSUES_URL = "https://github.com/jonborchardt/captions/issues/new";

// The local admin server URL. Admins click apply links while running
// `npm run ui` (default port 4173). The link 303-redirects to
// /admin/aliases with a toast banner once the mutation lands.
const LOCAL_APPLY_ROOT = "http://localhost:4173/admin/apply";

function applyLink(op: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ op, ...params });
  return `${LOCAL_APPLY_ROOT}?${qs.toString()}`;
}

// Safe URL back to the page the issue was opened from, so an admin
// can jump to the source in one click. `window` isn't available
// during SSR or tests, so guard access.
function currentPageUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

// Common "admin apply" section. Uses a labeled markdown link so the
// body scans cleanly in a browser, and a plain URL so GitHub auto-
// links it for the rare admin who needs to copy it.
function applySection(op: string, apply: string): string {
  return [
    "",
    "---",
    "",
    "### For the admin",
    "",
    `Click to apply on localhost (requires the local \`npm run ui\` server): [apply: ${op}](${apply})`,
    "",
    `Plain URL: \`${apply}\``,
  ].join("\n");
}

function sourceLine(where: string): string {
  const page = currentPageUrl();
  return page
    ? `**Seen on:** [${where}](${page})`
    : `**Seen on:** ${where}`;
}

// ---- Graph node / edge (open-ended feedback) ------------------------

export function graphNodeIssueUrl(node: GraphNode): string {
  // Graph nodes aggregate every mention of an entity across the
  // corpus. Common fixes (delete, merge, rename) already have their
  // own menu items on the graph page — this issue is for cases the
  // menu doesn't cover (bad label, missing evidence, split identity).
  const page = currentPageUrl();
  const lines = [
    `**Entity:** ${node.canonical}`,
    `**Label:** ${node.type}`,
    `**ID:** \`${node.id}\``,
    `**Aggregate weight:** ${node.weight ?? "—"}`,
    page ? `**Seen on:** ${page}` : "",
    "",
    "---",
    "",
    "### What's wrong?",
    "_Pick one and fill in the details:_",
    "",
    "- [ ] The label is wrong (should be: …)",
    "- [ ] This entity is really two different things and should be split",
    "- [ ] This entity is a duplicate of another one (link to the other: …)",
    "- [ ] The display name is wrong (suggested: …)",
    "- [ ] Something else (describe below)",
    "",
    "### Evidence",
    "Paste one or two transcript quotes (copy from a video page) that show the problem, with the video link + timestamp if possible.",
    "",
    "> <!-- quote here -->",
    "",
    "### Notes",
    "<!-- anything else the admin should know -->",
  ].filter(Boolean);
  const params = new URLSearchParams({
    title: `[graph/node] ${node.canonical}`,
    body: lines.join("\n"),
    labels: "graph-action,node",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function graphEdgeIssueUrl(
  edge: GraphEdge,
  nodesById: Record<string, GraphNode>,
): string {
  // Graph edges are aggregated across every video that extracted the
  // same subject-predicate-object. A single admin apply isn't
  // possible here (deletion is always per-video; the admin needs to
  // open the specific video and use the relation menu).
  const a = nodesById[edge.source];
  const b = nodesById[edge.target];
  const subj = a ? a.canonical : edge.source;
  const obj = b ? b.canonical : edge.target;
  const page = currentPageUrl();
  const lines = [
    `**Relationship:** ${subj} — *${edge.predicate}* — ${obj}`,
    `**Subject ID:** \`${edge.source}\``,
    `**Object ID:** \`${edge.target}\``,
    `**Aggregate count:** ${edge.count ?? "—"} (this predicate fired in that many video windows)`,
    page ? `**Seen on:** ${page}` : "",
    "",
    "---",
    "",
    "### What's wrong?",
    "_Pick one and fill in the details:_",
    "",
    "- [ ] The predicate is wrong (should be: …)",
    "- [ ] The subject or object is the wrong entity",
    "- [ ] This relationship is backwards",
    "- [ ] This relationship shouldn't exist for any video",
    "- [ ] Something else (describe below)",
    "",
    "### Evidence",
    "Graph edges are aggregated across every video. Point the admin at **one specific video** where the relationship is wrong — they can then open `/admin/video/<id>` and delete it per-video (which is how aggregate edges shrink).",
    "",
    "- **Video ID / URL:** <!-- e.g. https://www.youtube.com/watch?v=... -->",
    "- **Timestamp (mm:ss):** <!-- 12:34 -->",
    "- **Quote:** <!-- copy from the transcript -->",
    "",
    "### Notes",
    "<!-- anything else the admin should know -->",
  ].filter(Boolean);
  const params = new URLSearchParams({
    title: `[graph/edge] ${subj} ${edge.predicate} ${obj}`,
    body: lines.join("\n"),
    labels: "graph-action,edge",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

// Generic "suggest an edit" — open-ended feedback for areas without a
// dedicated action menu.
export function suggestIssueUrl(
  area: string,
  opts: { videoId?: string; extra?: string } = {},
): string {
  const page =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "";
  const title = `[suggest] ${area}${opts.videoId ? " — " + opts.videoId : ""}`;
  const lines = [
    `**Area:** ${area}`,
    page ? `**Page:** ${page}` : "",
  ];
  if (opts.videoId) {
    lines.push(`**Video ID:** ${opts.videoId}`);
    lines.push(`**Video URL:** https://www.youtube.com/watch?v=${opts.videoId}`);
  }
  if (opts.extra) lines.push(opts.extra);
  lines.push(
    "",
    "---",
    "",
    "### Your suggestion",
    "Describe the change you'd like to see. The more specific, the faster an admin can act:",
    "",
    "- What exactly is wrong or missing?",
    "- What should it be instead?",
    "",
    "<!-- your suggestion here -->",
    "",
    "### Evidence",
    "If this is a claim-of-fact problem, paste a transcript quote and a timestamp so the admin can verify:",
    "",
    "- **Timestamp (mm:ss):** <!-- 12:34 -->",
    "- **Quote:** <!-- copy the relevant transcript text -->",
    "",
    "### Notes",
    "<!-- anything else -->",
  );
  const params = new URLSearchParams({
    title,
    body: lines.filter(Boolean).join("\n"),
    labels: `suggestion,${area.replace(/\s+/g, "-")}`,
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

// ---- Entity edit-requests ------------------------------------------

interface EntityRef {
  key: string;        // e.g. "person:dan"
  canonical: string;  // display text
  label: string;      // entity label
}

export function deleteEntityIssueUrl(e: EntityRef, where: string): string {
  const apply = applyLink("delete", { key: e.key });
  const title = `[edit-request] delete entity "${e.canonical}"`;
  const lines = [
    `**Action:** delete entity`,
    `**Entity:** ${e.canonical}  \`${e.key}\` · [${e.label}]`,
    sourceLine(where),
    "",
    "### What happens if an admin accepts this",
    "The entity is dropped from the graph on the next indexes rebuild. Every relationship that touches it is also dropped. The per-video transcript data is not changed — the entity just stops showing up in search, facets, and the relationship graph.",
    "",
    "### Why should it be deleted?",
    "_Pick the best fit and add detail:_",
    "",
    "- [ ] It's transcript noise (e.g. `[music]`, a cue tag, an outro)",
    "- [ ] It's a generic noun that was mis-tagged as a named entity",
    "- [ ] It's a pronoun or role noun, not a specific thing",
    "- [ ] It never refers to a real entity on this corpus",
    "- [ ] Other (explain)",
    "",
    "<!-- your reason here -->",
    applySection("delete entity", apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,delete",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function renameEntityIssueUrl(
  e: EntityRef,
  suggested: string,
  where: string,
): string {
  const apply = applyLink("display", { key: e.key, value: suggested });
  const title = `[edit-request] rename "${e.canonical}" → "${suggested}"`;
  const lines = [
    `**Action:** rename display text`,
    `**Entity:** ${e.canonical}  \`${e.key}\` · [${e.label}]`,
    `**Suggested display:** ${suggested}`,
    sourceLine(where),
    "",
    "### What happens if an admin accepts this",
    `The entity's internal key stays the same (\`${e.key}\`), but it renders as **"${suggested}"** everywhere in the UI. Use this for capitalization fixes, accent marks, or canonical forms — not for merging two different entities (use the merge action for that).`,
    "",
    "### Why this spelling?",
    "- [ ] It's the subject's own preferred name",
    "- [ ] It matches a Wikipedia / IMDb / official page",
    "- [ ] The current form is an obvious typo or casing error",
    "- [ ] Other (explain)",
    "",
    "<!-- your reason here -->",
    applySection(`rename → "${suggested}"`, apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,rename",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function mergeEntityIssueUrl(
  from: EntityRef,
  to: EntityRef,
  where: string,
): string {
  const apply = applyLink("merge", { from: from.key, to: to.key });
  const title = `[edit-request] merge "${from.canonical}" → "${to.canonical}"`;
  const lines = [
    `**Action:** merge (corpus-wide)`,
    `**From:** ${from.canonical}  \`${from.key}\``,
    `**Into:** ${to.canonical}  \`${to.key}\``,
    `**Label:** [${from.label}]`,
    sourceLine(where),
    "",
    "### What happens if an admin accepts this",
    `Every mention of \`${from.key}\` across every video in the corpus is treated as \`${to.key}\`. The graph, search, facets, and relationship edges all reflect the merged identity after the next indexes rebuild. The per-video extraction data is not rewritten — the merge is applied on read.`,
    "",
    "### Why are these the same?",
    "- [ ] The short form is clearly an alias of the full form (first name → full name)",
    "- [ ] Both spellings / casings refer to the same subject",
    "- [ ] It's an acronym and its expansion",
    "- [ ] Other (explain)",
    "",
    "<!-- your reason here -->",
    "",
    "> ⚠ If these are only _sometimes_ the same (e.g. `Paul` is Paul McCartney in one video and Paul Benowitz in another), open a per-video rename request instead — use the `⋯` menu on the video page.",
    applySection(`merge → "${to.canonical}"`, apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,merge",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

// ---- Claim / contradiction edit-requests ---------------------------

export function claimTruthIssueUrl(
  claim: { id: string; videoId: string; text: string; directTruth?: number | null },
  suggestedTruth: number,
  rationale: string,
): string {
  const apply = applyLink("claim-truth-override", {
    claimId: claim.id,
    directTruth: String(suggestedTruth),
    rationale,
  });
  const title = `[edit-request] claim truth → ${suggestedTruth.toFixed(2)} (${claim.id})`;
  const lines = [
    `**Action:** override claim truth`,
    `**Claim ID:** \`${claim.id}\``,
    `**Video:** https://www.youtube.com/watch?v=${claim.videoId}`,
    `**Claim text:** ${claim.text}`,
    `**Current truth:** ${claim.directTruth ?? "— (uncalibrated)"}`,
    `**Suggested truth:** ${suggestedTruth.toFixed(2)}`,
    "",
    "### What happens if an admin accepts this",
    "The claim's `directTruth` is pinned to the suggested value. Every claim that depends on this one (via `supports` / `contradicts` / `presupposes`) has its derived truth recomputed on the next indexes rebuild. The public page will show `truth N.NN (override)`.",
    "",
    "### Rationale / evidence",
    `> ${rationale || "<!-- why should the truth be this value? cite sources -->"}`,
    "",
    "A strong rationale includes:",
    "- a primary source URL (paper, court filing, official record, …),",
    "- or a transcript quote + timestamp that clearly contradicts or confirms the claim,",
    "- or a published retraction / correction.",
    "",
    "_Avoid_ overrides backed only by opinion or by secondary reporting. The override is durable — it survives re-extraction.",
    applySection(`truth → ${suggestedTruth.toFixed(2)}`, apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,claim-truth",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function claimFieldIssueUrl(
  claim: { id: string; videoId: string; text: string },
  field: "text" | "kind" | "hostStance" | "rationale",
  suggestedValue: string,
): string {
  const apply = applyLink("claim-field-override", {
    claimId: claim.id,
    [field]: suggestedValue,
  });
  const title = `[edit-request] claim ${field} (${claim.id})`;
  // Per-field description so the reviewer knows what the field means
  // and how it'll render.
  const fieldHelp: Record<typeof field, string> = {
    text:
      "The thesis sentence. Keep it a single testable proposition — split compound claims into separate ones rather than editing them in.",
    kind:
      "The claim kind: `empirical` (fact about the world), `interpretive` (reading of evidence), `predictive` (future claim), `normative` (value judgment), `definitional` (framing / terminology).",
    hostStance:
      "How the host presents the claim: `asserts` (endorses), `denies` (rejects, often 'some people say X, but…'), `reports` (neutral), `questions` (raises without endorsing).",
    rationale:
      "Short operator-facing note explaining why the claim was extracted or scored the way it was.",
  };
  const lines = [
    `**Action:** edit claim \`${field}\``,
    `**Claim ID:** \`${claim.id}\``,
    `**Video:** https://www.youtube.com/watch?v=${claim.videoId}`,
    `**Claim text:** ${claim.text}`,
    `**Field:** \`${field}\``,
    `**Suggested value:** ${suggestedValue}`,
    "",
    "### What this field means",
    fieldHelp[field],
    "",
    "### What happens if an admin accepts this",
    `Only the \`${field}\` field is overridden. The original per-video claim file is not rewritten; the override lives in \`data/aliases.json\` and is applied on read. Re-extracting the claim invalidates it (by text hash for the text field).`,
    "",
    "### Why this change?",
    "<!-- include a transcript timestamp + quote where helpful -->",
    applySection(`claim ${field}`, apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: `edit-request,claim-${field}`,
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function contradictionDismissIssueUrl(
  leftId: string,
  rightId: string,
  reason: string,
): string {
  const apply = applyLink("dismiss-contradiction", {
    a: leftId,
    b: rightId,
    reason,
  });
  const title = `[edit-request] dismiss contradiction (${leftId} ↔ ${rightId})`;
  const lines = [
    `**Action:** dismiss contradiction`,
    `**Claim A:** \`${leftId}\``,
    `**Claim B:** \`${rightId}\``,
    "",
    "### What happens if an admin accepts this",
    "The pair is marked as not-a-real-conflict. It stops appearing on `/contradictions` and stops pulling truth down across the dependency graph. The underlying claims are unchanged.",
    "",
    "### Why these don't actually conflict",
    `> ${reason || "<!-- e.g. different contexts, different time periods, both compatible readings -->"}`,
    "",
    "Common reasons to dismiss:",
    "- different subjects that share a generic entity (`US`, `government`)",
    "- different time periods or events",
    "- one is a prediction, the other is a measurement",
    "- both claims can be simultaneously true under a sensible reading",
    applySection("dismiss contradiction", apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,dismiss-contradiction",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function customContradictionIssueUrl(
  leftId: string,
  rightId: string,
  summary: string,
): string {
  const apply = applyLink("custom-contradiction", {
    a: leftId,
    b: rightId,
    summary,
  });
  const title = `[edit-request] flag new contradiction (${leftId} ↔ ${rightId})`;
  const lines = [
    `**Action:** flag new contradiction (detector missed it)`,
    `**Claim A:** \`${leftId}\``,
    `**Claim B:** \`${rightId}\``,
    "",
    "### What happens if an admin accepts this",
    "The pair is added to `data/claims/contradictions.json` as a manual entry. It shows up on `/contradictions` under the `manual` tab and pulls truth down across the dependency graph, the same way an auto-detected contradiction does.",
    "",
    "### How do they conflict?",
    `> ${summary || "<!-- one sentence on what's incompatible about A and B -->"}`,
    "",
    "A good summary names the specific incompatibility (e.g. \"A says X was in 1967, B says the same event was in 1971\"). Avoid vague summaries like \"different takes\" — those should be left alone.",
    applySection("flag new contradiction", apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,flag-contradiction",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}

export function deleteRelationIssueUrl(
  videoId: string,
  subjectKey: string,
  subjectText: string,
  predicate: string,
  objectKey: string,
  objectText: string,
  timeStart: number,
): string {
  const compositeKey = `${subjectKey}|${predicate}|${objectKey}|${Math.floor(timeStart)}`;
  const apply = applyLink("delete-relation", {
    videoId,
    key: compositeKey,
  });
  const mmss = (() => {
    const t = Math.floor(timeStart);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  })();
  const title = `[edit-request] delete "${subjectText} ${predicate} ${objectText}" in ${videoId}`;
  const lines = [
    `**Action:** delete relationship (per-video only)`,
    `**Video ID:** ${videoId}`,
    `**Video URL:** https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timeStart)}s`,
    `**Relationship:** ${subjectText} — *${predicate}* — ${objectText}`,
    `**Subject:** \`${subjectKey}\``,
    `**Object:** \`${objectKey}\``,
    `**Timestamp:** ${mmss}`,
    "",
    "### What happens if an admin accepts this",
    `This one extracted relationship in video \`${videoId}\` is suppressed. Other videos that produced the same subject-predicate-object edge are unaffected — the aggregate edge shrinks by one but doesn't disappear unless every video's copy is deleted.`,
    "",
    "### Why is this wrong?",
    "- [ ] The predicate is wrong for what the host actually said",
    "- [ ] The subject or object is the wrong entity",
    "- [ ] The host is denying, not asserting, this relationship",
    "- [ ] It's noise from a transcript artifact",
    "- [ ] Other (explain)",
    "",
    "<!-- your reason here -->",
    "",
    "### Evidence",
    "Paste the transcript quote around the timestamp so the admin can verify:",
    "",
    "> <!-- copy the relevant sentence -->",
    applySection("delete relationship", apply),
  ];
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "edit-request,delete-rel",
  });
  return `${CAPTIONS_ISSUES_URL}?${params.toString()}`;
}
