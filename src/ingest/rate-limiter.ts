// Self-throttling HTTP client. Every YouTube call MUST go through this module.
//
// Limits (documented rationale):
//  - 1 req/sec sustained per host: YouTube's public endpoints tolerate roughly
//    this without triggering 429s in our experience.
//  - burst of 5: allows a short run-up without punishing a cold start.
//  - 10,000 requests/day global cap: matches the default YouTube Data API quota
//    so a misconfigured fetcher can't silently exceed the project quota.
//  - exponential backoff on 429/5xx with jitter up to 30s.
//
// Persistence: bucket state + daily counter are written to data/ratelimit.json
// so restarts don't reset the budget.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface RateLimiterOptions {
  ratePerSec: number;
  burst: number;
  dailyCap: number;
  statePath: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface PersistedState {
  tokens: number;
  lastRefill: number;
  day: string;
  dayCount: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function todayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class RateLimiter {
  private opts: Required<RateLimiterOptions>;
  private state: PersistedState;

  constructor(opts: RateLimiterOptions) {
    this.opts = {
      now: Date.now,
      sleep: defaultSleep,
      random: Math.random,
      ...opts,
    };
    this.state = this.load();
  }

  private load(): PersistedState {
    if (existsSync(this.opts.statePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.opts.statePath, "utf8"));
        return {
          tokens: Number(raw.tokens ?? this.opts.burst),
          lastRefill: Number(raw.lastRefill ?? this.opts.now()),
          day: String(raw.day ?? todayKey(this.opts.now())),
          dayCount: Number(raw.dayCount ?? 0),
        };
      } catch {
        /* fall through */
      }
    }
    return {
      tokens: this.opts.burst,
      lastRefill: this.opts.now(),
      day: todayKey(this.opts.now()),
      dayCount: 0,
    };
  }

  private persist(): void {
    mkdirSync(dirname(this.opts.statePath), { recursive: true });
    writeFileSync(this.opts.statePath, JSON.stringify(this.state), "utf8");
  }

  private refill(): void {
    const now = this.opts.now();
    const elapsed = (now - this.state.lastRefill) / 1000;
    const add = elapsed * this.opts.ratePerSec;
    this.state.tokens = Math.min(this.opts.burst, this.state.tokens + add);
    this.state.lastRefill = now;
    const day = todayKey(now);
    if (day !== this.state.day) {
      this.state.day = day;
      this.state.dayCount = 0;
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.state.dayCount >= this.opts.dailyCap) {
      throw new Error(
        `rate limiter: daily cap ${this.opts.dailyCap} reached for ${this.state.day}`,
      );
    }
    while (this.state.tokens < 1) {
      const need = 1 - this.state.tokens;
      const waitMs = Math.ceil((need / this.opts.ratePerSec) * 1000);
      await this.opts.sleep(waitMs);
      this.refill();
    }
    this.state.tokens -= 1;
    this.state.dayCount += 1;
    this.persist();
  }

  async backoff(attempt: number): Promise<void> {
    const base = Math.min(30000, 500 * 2 ** attempt);
    const jitter = Math.floor(this.opts.random() * 500);
    await this.opts.sleep(base + jitter);
  }

  get snapshot(): PersistedState {
    return { ...this.state };
  }
}

// Single shared limited fetch. Nothing else in the codebase should import raw
// fetch for YouTube traffic — import this instead.
export interface LimitedFetchOptions {
  limiter: RateLimiter;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

export function makeLimitedFetch(opts: LimitedFetchOptions): typeof fetch {
  const f = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 5;
  return (async (input: any, init?: any) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await opts.limiter.acquire();
      try {
        const res = await f(input, init);
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          await opts.limiter.backoff(attempt);
          continue;
        }
        return res;
      } catch (e) {
        lastErr = e;
        await opts.limiter.backoff(attempt);
      }
    }
    throw lastErr ?? new Error("rate-limited fetch: exhausted attempts");
  }) as typeof fetch;
}

let shared: RateLimiter | null = null;
let sharedFetch: typeof fetch | null = null;

export function getSharedLimiter(): RateLimiter {
  if (!shared) {
    shared = new RateLimiter({
      ratePerSec: 1,
      burst: 5,
      dailyCap: 10000,
      statePath: join(process.cwd(), "data", "ratelimit.json"),
    });
  }
  return shared;
}

export function limitedFetch(input: any, init?: any): Promise<Response> {
  if (!sharedFetch) {
    sharedFetch = makeLimitedFetch({ limiter: getSharedLimiter() });
  }
  return sharedFetch(input, init);
}
