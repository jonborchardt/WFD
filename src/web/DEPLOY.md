# Public site deploy

Read-only surface for the captions graph. It never mutates the graph —
comments and edit-requests go to `data/moderation/queue.jsonl`, which a
moderator processes out of band.

## Host

The site is a plain `node:http` server (`src/web/public-site.ts`). Any host
that runs Node >= 20 works. Recommended:

- **Fly.io** or a single small VPS. A single process is enough for the
  expected traffic; horizontal scaling would need the graph store to move
  off the local JSON file first.
- Put Caddy or Nginx in front for TLS and static caching of `/` and
  `/search` responses. Entity pages can cache for ~60s; `/evidence/:id`
  is effectively immutable and can cache for an hour.

## Build and run

```bash
npm install
npm run build
node dist/web/public-site.js
```

## Rate limiting

`PerIpLimiter` in `public-site.ts` caps requests per IP per minute. Tune
`perIpLimitPerMinute` per expected traffic; the default (60/min) is a
soft cap and can be reduced if abuse is observed. A reverse proxy in
front is still recommended for absolute protection.

## Invariants

- Never expose a write endpoint that touches the `GraphStore`.
- All user-submitted content (`/comment`, `/request`) must go through
  `ModerationQueue.append`, not the store.
- Requests over the body cap are rejected.
