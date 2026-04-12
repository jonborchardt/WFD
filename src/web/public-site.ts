// Public read-only website.
//
// Rules from CLAUDE.md:
//   - The public surface NEVER mutates the graph directly.
//   - Comments / edit-requests go to a moderated queue.
//   - Rate limiting and abuse protection on the public surface.
//
// Shape: a node:http server that exposes a few JSON endpoints + a few HTML
// pages. The handler is wrapped in a per-ip rate limiter that refuses the
// request rather than proxying to the store if the cap is exceeded. The
// queue is a plain append-only JSON file; moderators run a separate tool
// (not here) to process it.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  appendFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { GraphStore } from "../graph/store.js";
import { entityPage, searchEntities } from "../graph/query.js";
import { edgeEvidence } from "../ui/graph-view.js";
import { escapeHtml } from "../ui/server.js";

export interface PublicOptions {
  store: GraphStore;
  port?: number;
  moderationQueuePath?: string;
  perIpLimitPerMinute?: number;
}

interface IpBucket {
  count: number;
  windowStart: number;
}

export class PerIpLimiter {
  private buckets = new Map<string, IpBucket>();
  constructor(private limit: number, private windowMs = 60_000) {}
  allow(ip: string, now = Date.now()): boolean {
    const b = this.buckets.get(ip);
    if (!b || now - b.windowStart > this.windowMs) {
      this.buckets.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (b.count >= this.limit) return false;
    b.count++;
    return true;
  }
}

export interface ModerationEntry {
  kind: "comment" | "edit-request";
  createdAt: string;
  ip: string;
  entityId?: string;
  relationshipId?: string;
  body: string;
}

export class ModerationQueue {
  constructor(private path: string) {}
  append(entry: ModerationEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
  }
  readAll(): ModerationEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ModerationEntry);
  }
}

function getIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage, cap = 16_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > cap) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(body);
}

function searchPage(): string {
  return `<!doctype html><html><body>
    <h1>captions - search</h1>
    <form method="get" action="/entity">
      <input name="q" placeholder="who or what" />
      <button>search</button>
    </form>
  </body></html>`;
}

export function handlePublic(
  req: IncomingMessage,
  res: ServerResponse,
  opts: PublicOptions,
  limiter: PerIpLimiter,
  queue: ModerationQueue,
): void {
  const ip = getIp(req);
  if (!limiter.allow(ip)) {
    res.writeHead(429);
    res.end("rate limited");
    return;
  }
  const url = new URL(req.url ?? "/", "http://local");

  if (req.method === "GET" && url.pathname === "/") {
    html(res, 200, searchPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/search") {
    const q = url.searchParams.get("q") ?? "";
    json(res, 200, searchEntities(opts.store, q));
    return;
  }
  if (req.method === "GET" && url.pathname === "/entity") {
    const q = url.searchParams.get("q") ?? "";
    const hits = searchEntities(opts.store, q, 1);
    if (hits.length === 0) {
      html(res, 404, "<p>no match</p>");
      return;
    }
    const page = entityPage(opts.store, hits[0].entity.id);
    if (!page) {
      html(res, 404, "<p>missing</p>");
      return;
    }
    const groups = page.groups
      .map(
        (g) =>
          `<h3>${escapeHtml(g.predicate)}</h3><ul>${g.rows
            .map(
              (row) =>
                `<li>${escapeHtml(row.counterpart?.canonical ?? "?")} <a href="${escapeHtml(row.deepLink)}" target="_blank">evidence</a></li>`,
            )
            .join("")}</ul>`,
      )
      .join("");
    html(
      res,
      200,
      `<h1>${escapeHtml(page.entity.canonical)}</h1>${groups}<form method="post" action="/request"><input name="body"/><button>suggest edit</button></form>`,
    );
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/evidence/")) {
    const relId = decodeURIComponent(url.pathname.slice("/evidence/".length));
    const ev = edgeEvidence(opts.store, relId);
    if (!ev) {
      json(res, 404, { error: "not found" });
      return;
    }
    json(res, 200, ev);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/comment" || url.pathname === "/request")) {
    readBody(req)
      .then((raw) => {
        const body = new URLSearchParams(raw).get("body") ?? "";
        if (!body.trim()) {
          json(res, 400, { error: "empty body" });
          return;
        }
        queue.append({
          kind: url.pathname === "/comment" ? "comment" : "edit-request",
          createdAt: new Date().toISOString(),
          ip,
          entityId: url.searchParams.get("entityId") ?? undefined,
          relationshipId: url.searchParams.get("relationshipId") ?? undefined,
          body: body.slice(0, 4000),
        });
        json(res, 202, { queued: true });
      })
      .catch(() => {
        res.writeHead(400);
        res.end("bad request");
      });
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

export function startPublicSite(opts: PublicOptions): { close: () => Promise<void> } {
  const limiter = new PerIpLimiter(opts.perIpLimitPerMinute ?? 60);
  const queue = new ModerationQueue(
    opts.moderationQueuePath ?? join(process.cwd(), "data", "moderation", "queue.jsonl"),
  );
  const server = createServer((req, res) =>
    handlePublic(req, res, opts, limiter, queue),
  );
  server.listen(opts.port ?? 8080);
  return { close: () => new Promise((r) => server.close(() => r())) };
}

// Deploy notes for this site live in src/web/DEPLOY.md. Keep this module
// free of host-specific code so tests can exercise handlePublic directly.
