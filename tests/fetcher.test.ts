import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseTimedText,
  parseWatchPage,
  pickTrack,
  fetchTranscript,
  fetchAndStore,
  TranscriptFetchError,
  transcriptPath,
  atomicWriteJson,
} from "../src/ingest/transcript.js";
import { RateLimiter, makeLimitedFetch } from "../src/ingest/rate-limiter.js";
import { Catalog } from "../src/catalog/catalog.js";
import { detectGaps, recordFailure, recordSuccess } from "../src/catalog/gaps.js";

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `captions-${prefix}-`));
}

function watchPageWith(tracks: Array<{ languageCode: string; kind?: string; baseUrl: string }>): string {
  return `<html>...{"captionTracks":${JSON.stringify(tracks)}}...</html>`;
}

const TIMED_TEXT = `<?xml version="1.0"?><transcript>
  <text start="0.5" dur="1.2">hello &amp; world</text>
  <text start="1.7" dur="2.0">second line</text>
</transcript>`;

describe("parseTimedText", () => {
  it("decodes entities and yields cues", () => {
    const cues = parseTimedText(TIMED_TEXT);
    expect(cues).toEqual([
      { start: 0.5, duration: 1.2, text: "hello & world" },
      { start: 1.7, duration: 2.0, text: "second line" },
    ]);
  });
});

describe("parseWatchPage", () => {
  it("detects private videos", () => {
    expect(
      parseWatchPage('{"playabilityStatus":{"status":"LOGIN_REQUIRED"}}').state,
    ).toBe("private");
  });
  it("detects removed videos", () => {
    expect(
      parseWatchPage('{"playabilityStatus":{"status":"ERROR"}}').state,
    ).toBe("removed");
  });
  it("ignores a bare status:ERROR string outside playabilityStatus", () => {
    // Real YouTube pages embed localized strings like "status":"ERROR"
    // inside translation tables; they must not trip the removed detector.
    const html = `<html>{"playabilityStatus":{"status":"OK"}}...{"status":"ERROR"}...{"captionTracks":[{"languageCode":"en","baseUrl":"http://x/a"}]}</html>`;
    expect(parseWatchPage(html).state).toBe("ok");
  });
  it("reports no-captions when captionTracks missing", () => {
    expect(parseWatchPage("<html>nothing</html>").state).toBe("no-captions");
  });
  it("parses caption tracks", () => {
    const html = watchPageWith([
      { languageCode: "en", kind: "asr", baseUrl: "http://x/a" },
      { languageCode: "en", baseUrl: "http://x/m" },
    ]);
    const parsed = parseWatchPage(html);
    expect(parsed.state).toBe("ok");
    expect(parsed.tracks).toHaveLength(2);
    expect(pickTrack(parsed.tracks)?.kind).toBe("manual");
  });
});

function fakeFetch(routes: Record<string, () => Response>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) return routes[key]();
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function limiterFor(fetchImpl: typeof fetch): typeof fetch {
  const rl = new RateLimiter({
    ratePerSec: 1000,
    burst: 1000,
    dailyCap: 100,
    statePath: join(tmpDir("rl"), "state.json"),
    now: () => 1,
    sleep: async () => {},
    random: () => 0,
  });
  return makeLimitedFetch({ limiter: rl, fetchImpl });
}

describe("fetchTranscript", () => {
  it("fetches, parses, and returns a normalized transcript", async () => {
    const routes = {
      "youtube.com/watch": () =>
        new Response(
          watchPageWith([{ languageCode: "en", baseUrl: "http://cap/x" }]),
          { status: 200 },
        ),
      "http://cap/x": () => new Response(TIMED_TEXT, { status: 200 }),
    };
    const { impl, calls } = fakeFetch(routes);
    const result = await fetchTranscript("abc12345678", {
      fetchImpl: limiterFor(impl),
    });
    expect(result.videoId).toBe("abc12345678");
    expect(result.cues).toHaveLength(2);
    // watch page + one json3 attempt (empty parse) + one srv1 attempt.
    expect(calls.length).toBe(3);
  });

  it("throws no-captions when none exist", async () => {
    const routes = {
      "youtube.com/watch": () =>
        new Response("<html>no tracks</html>", { status: 200 }),
    };
    await expect(
      fetchTranscript("abc", { fetchImpl: limiterFor(fakeFetch(routes).impl) }),
    ).rejects.toBeInstanceOf(TranscriptFetchError);
  });

  it("distinguishes private from removed", async () => {
    const priv = {
      "youtube.com/watch": () =>
        new Response(
          '{"playabilityStatus":{"status":"LOGIN_REQUIRED"}}',
          { status: 200 },
        ),
    };
    try {
      await fetchTranscript("p", { fetchImpl: limiterFor(fakeFetch(priv).impl) });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TranscriptFetchError).failure.kind).toBe("private");
    }
    const gone = {
      "youtube.com/watch": () =>
        new Response(
          '{"playabilityStatus":{"status":"ERROR"}}',
          { status: 200 },
        ),
    };
    try {
      await fetchTranscript("r", { fetchImpl: limiterFor(fakeFetch(gone).impl) });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TranscriptFetchError).failure.kind).toBe("removed");
    }
  });

  it("surfaces 404 as a network failure", async () => {
    const routes = {
      "youtube.com/watch": () => new Response("", { status: 404 }),
    };
    try {
      await fetchTranscript("x", {
        fetchImpl: limiterFor(fakeFetch(routes).impl),
      });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TranscriptFetchError).failure.kind).toBe("network");
    }
  });
});

describe("fetchAndStore integration with catalog + gaps", () => {
  it("writes transcript, catalog row reflects fetched state, gap detector agrees", async () => {
    const dir = tmpDir("store");
    const dataDir = join(dir, "transcripts");
    const routes = {
      "youtube.com/watch": () =>
        new Response(
          watchPageWith([{ languageCode: "en", baseUrl: "http://cap/x" }]),
          { status: 200 },
        ),
      "http://cap/x": () => new Response(TIMED_TEXT, { status: 200 }),
    };
    const { impl } = fakeFetch(routes);
    const path = await fetchAndStore("vid00000001", {
      fetchImpl: limiterFor(impl),
      dataDir,
    });
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.cues).toHaveLength(2);

    const catPath = join(dir, "catalog.json");
    const cat = new Catalog(catPath);
    cat.seed([{ videoId: "vid00000001" }]);
    recordSuccess(cat, "vid00000001", path);
    const report = detectGaps(cat);
    expect(report.ok).toHaveLength(1);
    expect(report.retry).toHaveLength(0);
  });

  it("gap detector buckets failures correctly", () => {
    const cat = new Catalog(join(tmpDir("gap"), "catalog.json"));
    cat.seed([{ videoId: "aaaaaaaaaaa" }, { videoId: "bbbbbbbbbbb" }]);
    recordFailure(cat, "aaaaaaaaaaa", "retryable", "flaky");
    recordFailure(cat, "bbbbbbbbbbb", "needs-user", "no captions");
    const report = detectGaps(cat);
    expect(report.retry.map((g) => g.row.videoId)).toContain("aaaaaaaaaaa");
    expect(report.needsUser.map((g) => g.row.videoId)).toContain("bbbbbbbbbbb");
  });
});

describe("atomic write", () => {
  it("never leaves a half-written file at the final path", () => {
    const dir = tmpDir("atomic");
    const path = join(dir, "file.json");
    try {
      atomicWriteJson(path, {
        get bomb() {
          throw new Error("serialize fail");
        },
      });
      expect.fail("expected throw");
    } catch {
      // expected
    }
    const files = readdirSync(dir);
    // Either nothing exists, or only a .tmp — but never the final path.
    expect(files.includes("file.json")).toBe(false);
  });

  it("path helper lives under data/transcripts/<id>.json", () => {
    const p = transcriptPath("abc", "/tmp/x");
    expect(p).toMatch(/abc\.json$/);
  });
});
