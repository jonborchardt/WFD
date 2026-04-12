# ingest

Pull transcripts from YouTube and write them to local `data/transcripts/`. All
fetches MUST go through the shared rate limiter — never call YouTube directly.

Responsibilities:
- YouTube transcript fetcher
- Self-throttling rate limiter
- Local write + handoff to `catalog/`
- Queue for videos that need a user action (e.g. no auto-caption available)

Status: not implemented.
