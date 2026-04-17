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
