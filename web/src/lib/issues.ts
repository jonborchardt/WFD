// GitHub issue URL generators.

import type { GraphNode, GraphEdge } from "../types";

const WFD_ISSUES_URL = "https://github.com/jonborchardt/WFD/issues/new";
const CAPTIONS_ISSUES_URL = "https://github.com/jonborchardt/captions/issues/new";

export function graphNodeIssueUrl(node: GraphNode): string {
  const lines = [
    "**Entity:** " + node.canonical,
    "**Type:** " + node.type,
    "**ID:** " + node.id,
    "**Weight:** " + (node.weight != null ? node.weight : ""),
    "",
    "---",
    "",
    "**Action requested:** <!-- e.g. merge with another entity, retype, remove -->",
    "",
    "**Notes:**",
  ];
  const params = new URLSearchParams({
    title: "[graph/node] " + node.canonical,
    body: lines.join("\n"),
    labels: "graph-action,node",
  });
  return CAPTIONS_ISSUES_URL + "?" + params.toString();
}

export function graphEdgeIssueUrl(
  edge: GraphEdge,
  nodesById: Record<string, GraphNode>,
): string {
  const a = nodesById[edge.source];
  const b = nodesById[edge.target];
  const subj = a ? a.canonical : edge.source;
  const obj = b ? b.canonical : edge.target;
  const lines = [
    "**Subject:** " + subj + " (" + edge.source + ")",
    "**Predicate:** " + edge.predicate,
    "**Object:** " + obj + " (" + edge.target + ")",
    "**Relationship ID:** " + edge.id,
    "**Count:** " + (edge.count != null ? edge.count : ""),
    "",
    "---",
    "",
    "**Action requested:** <!-- e.g. dispute, add evidence, re-predicate, delete -->",
    "",
    "**Notes:**",
  ];
  const params = new URLSearchParams({
    title: "[graph/edge] " + subj + " " + edge.predicate + " " + obj,
    body: lines.join("\n"),
    labels: "graph-action,edge",
  });
  return CAPTIONS_ISSUES_URL + "?" + params.toString();
}

export function suggestIssueUrl(
  area: string,
  opts: { videoId?: string; extra?: string } = {},
): string {
  const page = location.pathname + location.search;
  const title = "[suggest] " + area + (opts.videoId ? " — " + opts.videoId : "");
  const lines = [
    "**Area:** " + area,
    "**Page:** " + page,
  ];
  if (opts.videoId) {
    lines.push("**Video ID:** " + opts.videoId);
    lines.push("**Video URL:** https://www.youtube.com/watch?v=" + opts.videoId);
  }
  if (opts.extra) lines.push(opts.extra);
  lines.push("", "---", "");
  lines.push("**Your suggestion:** <!-- what should be added or changed -->");
  lines.push("");
  lines.push("**Evidence timestamp (mm:ss):** <!-- e.g. 12:34 -->");
  lines.push("");
  lines.push("**Evidence quote:** <!-- copy the relevant transcript text -->");
  lines.push("");
  lines.push("**Notes:**");
  const params = new URLSearchParams({
    title,
    body: lines.join("\n"),
    labels: "suggestion," + area.replace(/\s+/g, "-"),
  });
  return WFD_ISSUES_URL + "?" + params.toString();
}

// Alias / override action suggestions. The public site renders a menu
// that lands the user in a GitHub issue prefilled with structured
// fields. Each issue body includes a localhost apply link that an
// admin can one-click to write the aliases entry directly.

const LOCAL_APPLY_ROOT = "http://localhost:4173/admin/apply";

function applyLink(op: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ op, ...params });
  return `${LOCAL_APPLY_ROOT}?${qs.toString()}`;
}

interface EntityRef {
  key: string;        // e.g. "person:dan"
  canonical: string;  // display text
  label: string;      // entity label
}

export function deleteEntityIssueUrl(e: EntityRef, where: string): string {
  const apply = applyLink("delete", { key: e.key });
  const title = `[edit-request] delete entity "${e.canonical}"`;
  const lines = [
    `**Action:** delete entity (drop from graph)`,
    `**Entity key:** \`${e.key}\``,
    `**Canonical:** ${e.canonical}`,
    `**Label:** ${e.label}`,
    `**Seen on:** ${where}`,
    "",
    "**Reason:** <!-- why should this be deleted? -->",
    "",
    "---",
    "",
    `**Admin apply link (localhost only):** ${apply}`,
  ];
  return (
    CAPTIONS_ISSUES_URL +
    "?" +
    new URLSearchParams({
      title,
      body: lines.join("\n"),
      labels: "edit-request,delete",
    }).toString()
  );
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
    `**Entity key:** \`${e.key}\``,
    `**Current:** ${e.canonical}`,
    `**Suggested:** ${suggested}`,
    `**Label:** ${e.label}`,
    `**Seen on:** ${where}`,
    "",
    "---",
    "",
    `**Admin apply link (localhost only):** ${apply}`,
  ];
  return (
    CAPTIONS_ISSUES_URL +
    "?" +
    new URLSearchParams({
      title,
      body: lines.join("\n"),
      labels: "edit-request,rename",
    }).toString()
  );
}

export function mergeEntityIssueUrl(
  from: EntityRef,
  to: EntityRef,
  where: string,
): string {
  const apply = applyLink("merge", { from: from.key, to: to.key });
  const title = `[edit-request] merge "${from.canonical}" → "${to.canonical}"`;
  const lines = [
    `**Action:** merge`,
    `**From:** \`${from.key}\` (${from.canonical})`,
    `**Into:** \`${to.key}\` (${to.canonical})`,
    `**Label:** ${from.label}`,
    `**Seen on:** ${where}`,
    "",
    "---",
    "",
    `**Admin apply link (localhost only):** ${apply}`,
  ];
  return (
    CAPTIONS_ISSUES_URL +
    "?" +
    new URLSearchParams({
      title,
      body: lines.join("\n"),
      labels: "edit-request,merge",
    }).toString()
  );
}

export function videoRenameIssueUrl(
  e: EntityRef,
  target: EntityRef,
  videoId: string,
): string {
  const apply = applyLink("video-merge", {
    videoId,
    from: e.key,
    to: target.key,
  });
  const title = `[edit-request] (video ${videoId}) rename "${e.canonical}" → "${target.canonical}"`;
  const lines = [
    `**Action:** per-video rename`,
    `**Video ID:** ${videoId}`,
    `**Entity:** \`${e.key}\` (${e.canonical})`,
    `**Target:** \`${target.key}\` (${target.canonical})`,
    "",
    "---",
    "",
    `**Admin apply link (localhost only):** ${apply}`,
  ];
  return (
    CAPTIONS_ISSUES_URL +
    "?" +
    new URLSearchParams({
      title,
      body: lines.join("\n"),
      labels: "edit-request,video-rename",
    }).toString()
  );
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
  const title = `[edit-request] delete "${subjectText} ${predicate} ${objectText}" in ${videoId}`;
  const lines = [
    `**Action:** delete relationship (per-video)`,
    `**Video ID:** ${videoId}`,
    `**Subject:** ${subjectText} (\`${subjectKey}\`)`,
    `**Predicate:** ${predicate}`,
    `**Object:** ${objectText} (\`${objectKey}\`)`,
    `**Time:** ${Math.floor(timeStart)}s`,
    "",
    "**Reason:** <!-- why is this wrong? -->",
    "",
    "---",
    "",
    `**Admin apply link (localhost only):** ${apply}`,
  ];
  return (
    CAPTIONS_ISSUES_URL +
    "?" +
    new URLSearchParams({
      title,
      body: lines.join("\n"),
      labels: "edit-request,delete-rel",
    }).toString()
  );
}
