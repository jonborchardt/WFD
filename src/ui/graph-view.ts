// Relationship map visualization.
//
// Rendering lib choice: none. We render to a plain <canvas> using a tiny
// force-directed layout built in place. Rationale: (a) no build step, (b) no
// external CDN fetch from the public site, (c) the graph size we expect in
// the browser is small because filters and paging keep node counts low.
// Swapping to cytoscape or sigma later would be a contained change in this
// file.

import { Entity, Relationship, RelationshipType } from "../shared/types.js";
import { GraphStore } from "../graph/store.js";
import { escapeHtml } from "./server.js";

export interface ViewFilter {
  entityTypes?: Entity["type"][];
  predicates?: RelationshipType[];
  minTruth?: number; // filter by derivedTruth (or directTruth) >= threshold
}

export interface ViewSlice {
  nodes: Array<Pick<Entity, "id" | "type" | "canonical">>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    predicate: RelationshipType;
    truth?: number;
  }>;
}

export function sliceForView(
  store: GraphStore,
  filter: ViewFilter = {},
): ViewSlice {
  const edges: ViewSlice["edges"] = [];
  const usedNodeIds = new Set<string>();
  for (const r of store.relationships()) {
    if (filter.predicates && !filter.predicates.includes(r.predicate)) continue;
    const truth = r.derivedTruth ?? r.directTruth;
    if (filter.minTruth !== undefined) {
      if (truth === undefined || truth < filter.minTruth) continue;
    }
    edges.push({
      id: r.id,
      source: r.subjectId,
      target: r.objectId,
      predicate: r.predicate,
      truth,
    });
    usedNodeIds.add(r.subjectId);
    usedNodeIds.add(r.objectId);
  }
  const nodes = [...usedNodeIds]
    .map((id) => store.getEntity(id))
    .filter((e): e is Entity => !!e)
    .filter(
      (e) => !filter.entityTypes || filter.entityTypes.includes(e.type),
    )
    .map((e) => ({ id: e.id, type: e.type, canonical: e.canonical }));
  // Drop edges whose endpoints were filtered out.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  return { nodes, edges: filteredEdges };
}

// Expand a neighborhood slice around one entity, one hop out. Used by the
// node-click handler in the UI.
export function neighborhood(store: GraphStore, entityId: string): ViewSlice {
  const rels = store.byEntity(entityId);
  const nodeIds = new Set<string>([entityId]);
  for (const r of rels) {
    nodeIds.add(r.subjectId);
    nodeIds.add(r.objectId);
  }
  const nodes = [...nodeIds]
    .map((id) => store.getEntity(id))
    .filter((e): e is Entity => !!e)
    .map((e) => ({ id: e.id, type: e.type, canonical: e.canonical }));
  const edges = rels.map((r) => ({
    id: r.id,
    source: r.subjectId,
    target: r.objectId,
    predicate: r.predicate,
    truth: r.derivedTruth ?? r.directTruth,
  }));
  return { nodes, edges };
}

// Evidence view for one edge: full relationship plus a deep link back to the
// video at the right timestamp.
export interface EdgeEvidence {
  relationship: Relationship;
  deepLink: string;
}

export function edgeEvidence(
  store: GraphStore,
  relationshipId: string,
): EdgeEvidence | null {
  const r = store.getRelationship(relationshipId);
  if (!r) return null;
  const t = Math.floor(r.evidence.timeStart);
  return {
    relationship: r,
    deepLink: `https://www.youtube.com/watch?v=${encodeURIComponent(r.evidence.transcriptId)}&t=${t}s`,
  };
}

// Standalone HTML page. Embeds the slice as inline JSON so the page renders
// without a server round-trip.
export function renderGraphPage(slice: ViewSlice): string {
  const data = JSON.stringify(slice);
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>captions - graph</title>
<style>
  body{margin:0;font-family:system-ui;background:#111;color:#eee}
  canvas{display:block;width:100vw;height:100vh}
  #info{position:fixed;top:0;left:0;padding:.5em;background:#0008;max-width:40ch}
</style></head><body>
<div id="info">hover a node or edge</div>
<canvas id="c"></canvas>
<script>
  const slice = ${data};
  const canvas = document.getElementById('c');
  const info = document.getElementById('info');
  const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  const nodes = slice.nodes.map(n => ({
    ...n,
    x: Math.random()*innerWidth,
    y: Math.random()*innerHeight,
    vx: 0, vy: 0,
  }));
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
  const edges = slice.edges;
  const COLORS = { person:'#f66', organization:'#6f6', location:'#66f', misc:'#fc6', time:'#c6f' };
  function step(){
    for (const n of nodes){
      for (const m of nodes){
        if (n===m) continue;
        const dx=n.x-m.x, dy=n.y-m.y;
        const d=Math.hypot(dx,dy)||1;
        const f=200/(d*d);
        n.vx+=dx/d*f; n.vy+=dy/d*f;
      }
    }
    for (const e of edges){
      const a=nodeById[e.source], b=nodeById[e.target];
      if (!a||!b) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const d=Math.hypot(dx,dy)||1;
      const f=(d-120)*0.02;
      a.vx+=dx/d*f; a.vy+=dy/d*f;
      b.vx-=dx/d*f; b.vy-=dy/d*f;
    }
    for (const n of nodes){
      n.vx*=0.8; n.vy*=0.8;
      n.x+=n.vx; n.y+=n.vy;
      n.x=Math.max(20,Math.min(canvas.width-20,n.x));
      n.y=Math.max(20,Math.min(canvas.height-20,n.y));
    }
  }
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#888';
    for (const e of edges){
      const a=nodeById[e.source], b=nodeById[e.target];
      if (!a||!b) continue;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    for (const n of nodes){
      ctx.fillStyle=COLORS[n.type]||'#ddd';
      ctx.beginPath(); ctx.arc(n.x,n.y,8,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#eee'; ctx.font='11px sans-serif';
      ctx.fillText(n.canonical, n.x+10, n.y+4);
    }
  }
  function frame(){ step(); draw(); requestAnimationFrame(frame); }
  frame();
  const ISSUES_URL = 'https://github.com/jonborchardt/captions/issues/new';
  function esc(s){ const d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
  function issueUrl(kind, title, lines, labels){
    const body = lines.concat(['','---','','**Action requested:** <!-- what should change -->','']).join('\\n');
    const p = new URLSearchParams({ title: '[graph/'+kind+'] '+title, body, labels: 'graph-action,'+kind });
    return ISSUES_URL+'?'+p.toString();
  }
  function nodeIssueUrl(n){
    return issueUrl('node', n.canonical, [
      '**Entity:** '+n.canonical,
      '**Type:** '+n.type,
      '**ID:** '+n.id,
    ], 'node');
  }
  function edgeIssueUrl(e, deepLink){
    const a=nodeById[e.source], b=nodeById[e.target];
    const title = (a?a.canonical:e.source)+' '+e.predicate+' '+(b?b.canonical:e.target);
    const lines = [
      '**Subject:** '+(a?a.canonical:e.source)+' ('+e.source+')',
      '**Predicate:** '+e.predicate,
      '**Object:** '+(b?b.canonical:e.target)+' ('+e.target+')',
      '**Relationship ID:** '+e.id,
    ];
    if (e.truth!=null) lines.push('**Truth:** '+e.truth);
    if (deepLink) lines.push('**Evidence:** '+deepLink);
    return issueUrl('edge', title, lines);
  }
  function renderNode(hit, neighborCount){
    const url = nodeIssueUrl(hit);
    info.innerHTML = '<div><b>'+esc(hit.canonical)+'</b> <span style="opacity:.7">('+esc(hit.type)+')</span></div>'+
      (neighborCount!=null?'<div style="opacity:.7">'+neighborCount+' edges</div>':'')+
      '<div style="margin-top:.4em"><a href="'+url+'" target="_blank" rel="noopener" style="color:#9cf">create issue for this node</a></div>';
  }
  function renderEdge(edge, deepLink){
    const a=nodeById[edge.source], b=nodeById[edge.target];
    const url = edgeIssueUrl(edge, deepLink);
    info.innerHTML = '<div><b>'+esc(a?a.canonical:edge.source)+'</b> '+esc(edge.predicate)+' <b>'+esc(b?b.canonical:edge.target)+'</b></div>'+
      (deepLink?'<div><a href="'+esc(deepLink)+'" target="_blank" style="color:#9cf">evidence</a></div>':'')+
      '<div style="margin-top:.4em"><a href="'+url+'" target="_blank" rel="noopener" style="color:#9cf">create issue for this edge</a></div>';
  }
  canvas.addEventListener('click', ev => {
    const x=ev.clientX, y=ev.clientY;
    const hit=nodes.find(n => Math.hypot(n.x-x,n.y-y)<10);
    if (hit){
      renderNode(hit, null);
      fetch('/graph/neighbor/'+encodeURIComponent(hit.id))
        .then(r=>r.ok?r.json():null)
        .then(s => { if (s) renderNode(hit, s.edges.length); })
        .catch(()=>{});
      return;
    }
    const edge=edges.find(e => {
      const a=nodeById[e.source], b=nodeById[e.target];
      if (!a||!b) return false;
      const d = Math.abs((b.y-a.y)*x-(b.x-a.x)*y+b.x*a.y-b.y*a.x)/Math.hypot(b.y-a.y,b.x-a.x);
      return d<4;
    });
    if (edge){
      renderEdge(edge, null);
      fetch('/graph/evidence/'+encodeURIComponent(edge.id))
        .then(r=>r.ok?r.json():null)
        .then(ev2 => { if (ev2 && ev2.deepLink) renderEdge(edge, ev2.deepLink); })
        .catch(()=>{});
    }
  });
</script>
</body></html>`;
}

export function renderLegend(): string {
  return `<ul>${["person", "organization", "location", "misc", "time"]
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("")}</ul>`;
}
