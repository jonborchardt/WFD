import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateLimiter, makeLimitedFetch } from "../src/ingest/rate-limiter.js";

function tmpState(): string {
  const dir = mkdtempSync(join(tmpdir(), "captions-rl-"));
  return join(dir, "ratelimit.json");
}

function fakeClock() {
  let t = 1_700_000_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => (t += ms),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0.5,
    sleeps,
  };
}

describe("RateLimiter", () => {
  it("allows a burst then throttles sustained traffic", async () => {
    const clk = fakeClock();
    const rl = new RateLimiter({
      ratePerSec: 1,
      burst: 3,
      dailyCap: 100,
      statePath: tmpState(),
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    for (let i = 0; i < 3; i++) await rl.acquire();
    expect(clk.sleeps.length).toBe(0);
    await rl.acquire();
    expect(clk.sleeps.length).toBeGreaterThan(0);
  });

  it("refills sustained at the configured rate", async () => {
    const clk = fakeClock();
    const rl = new RateLimiter({
      ratePerSec: 2,
      burst: 1,
      dailyCap: 100,
      statePath: tmpState(),
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    await rl.acquire();
    clk.advance(500);
    await rl.acquire();
    expect(clk.sleeps.length).toBe(0);
  });

  it("backoff produces monotonically non-decreasing waits", async () => {
    const clk = fakeClock();
    const rl = new RateLimiter({
      ratePerSec: 5,
      burst: 1,
      dailyCap: 100,
      statePath: tmpState(),
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    await rl.backoff(0);
    await rl.backoff(1);
    await rl.backoff(2);
    expect(clk.sleeps[0]).toBeLessThanOrEqual(clk.sleeps[1]);
    expect(clk.sleeps[1]).toBeLessThanOrEqual(clk.sleeps[2]);
  });

  it("persists state across instances", async () => {
    const clk = fakeClock();
    const path = tmpState();
    const a = new RateLimiter({
      ratePerSec: 1,
      burst: 5,
      dailyCap: 100,
      statePath: path,
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    await a.acquire();
    await a.acquire();
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.dayCount).toBe(2);
    const b = new RateLimiter({
      ratePerSec: 1,
      burst: 5,
      dailyCap: 100,
      statePath: path,
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    expect(b.snapshot.dayCount).toBe(2);
  });

  it("enforces the daily cap", async () => {
    const clk = fakeClock();
    const rl = new RateLimiter({
      ratePerSec: 1000,
      burst: 1000,
      dailyCap: 2,
      statePath: tmpState(),
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    await rl.acquire();
    await rl.acquire();
    await expect(rl.acquire()).rejects.toThrow(/daily cap/);
  });

  it("makeLimitedFetch retries on 429 then succeeds", async () => {
    const clk = fakeClock();
    const rl = new RateLimiter({
      ratePerSec: 1000,
      burst: 1000,
      dailyCap: 100,
      statePath: tmpState(),
      now: clk.now,
      sleep: clk.sleep,
      random: clk.random,
    });
    let n = 0;
    const fake = async () => {
      n++;
      if (n < 2) return new Response("", { status: 429 });
      return new Response("ok", { status: 200 });
    };
    const lf = makeLimitedFetch({
      limiter: rl,
      fetchImpl: fake as unknown as typeof fetch,
    });
    const res = await lf("http://x");
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });
});
