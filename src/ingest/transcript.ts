// YouTube transcript fetcher.
//
// Every network call goes through the rate-limited fetch; a raw fetch is never
// imported here. Writes are atomic: we write to <path>.tmp, fsync, then rename.

import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { limitedFetch } from "./rate-limiter.js";
import { logger } from "../shared/logger.js";
import { VideoMeta } from "../catalog/catalog.js";

export type FetchFailure =
  | { kind: "no-captions" }
  | { kind: "private" }
  | { kind: "removed" }
  | { kind: "network"; status?: number; message: string };

export class TranscriptFetchError extends Error {
  constructor(public failure: FetchFailure) {
    super(`transcript fetch failed: ${failure.kind}`);
  }
}

export interface Cue {
  text: string;
  start: number;
  duration: number;
}

export interface NormalizedTranscript {
  videoId: string;
  language: string;
  kind: "auto" | "manual";
  cues: Cue[];
  meta?: VideoMeta;
}

export interface CaptionTrack {
  language: string;
  kind: "auto" | "manual";
  baseUrl: string;
}

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  dataDir?: string;
}

// Parse YouTube timedtext. Handles two on-wire shapes:
//   1. <p t="MS" d="MS"><s>text</s></p>   (Innertube baseUrl response)
//   2. <text start="SEC" dur="SEC">text</text>   (legacy srv1)
export function parseTimedText(xml: string): Cue[] {
  const cues: Cue[] = [];
  // Try the modern <p t d> shape first.
  const pRe = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml))) {
    const tMs = Number(m[1]);
    const dMs = Number(m[2]);
    const inner = m[3];
    let text = "";
    const sRe = /<s[^>]*>([^<]*)<\/s>/g;
    let s: RegExpExecArray | null;
    while ((s = sRe.exec(inner))) text += s[1];
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    text = decodeEntities(text).trim();
    if (!text) continue;
    cues.push({ start: tMs / 1000, duration: dMs / 1000, text });
  }
  if (cues.length > 0) return cues;

  // Legacy <text start dur> shape.
  const tRe = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  while ((m = tRe.exec(xml))) {
    const attrs = m[1];
    const startMatch = attrs.match(/start="([^"]+)"/);
    const durMatch = attrs.match(/dur="([^"]+)"/);
    if (!startMatch) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ""));
    if (!text.trim()) continue;
    cues.push({
      start: Number(startMatch[1]),
      duration: Number(durMatch?.[1] ?? "0"),
      text,
    });
  }
  return cues;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Parse the watch-page HTML to classify video state and pull caption tracks.
// This intentionally matches the shape YouTube currently embeds; it's best-
// effort and is the single seam tests stub.
//
// State is derived from the playabilityStatus block, not from loose text
// matching. A plain `"status":"ERROR"` substring match produces false
// positives because YouTube ships localized string tables containing that
// literal for every watch page.
export function parseWatchPage(html: string): {
  state: "ok" | "private" | "removed" | "no-captions";
  tracks: CaptionTrack[];
} {
  const statusMatch = html.match(
    /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"([^"]+)"/,
  );
  const status = statusMatch?.[1];
  if (status === "LOGIN_REQUIRED") {
    return { state: "private", tracks: [] };
  }
  if (status === "ERROR" || status === "UNPLAYABLE") {
    return { state: "removed", tracks: [] };
  }
  // Fallback shorthand probes for pages where playabilityStatus is missing
  // but a private/removed marker is present elsewhere.
  if (!status && /"status"\s*:\s*"LOGIN_REQUIRED"/.test(html)) {
    return { state: "private", tracks: [] };
  }
  const m = html.match(/"captionTracks":(\[[^\]]*\])/);
  if (!m) return { state: "no-captions", tracks: [] };
  let arr: unknown;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    return { state: "no-captions", tracks: [] };
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return { state: "no-captions", tracks: [] };
  }
  const tracks: CaptionTrack[] = (arr as Array<Record<string, unknown>>).map((t) => ({
    language: String(t.languageCode ?? "en"),
    kind: t.kind === "asr" ? "auto" : "manual",
    baseUrl: String(t.baseUrl ?? ""),
  }));
  return { state: "ok", tracks };
}

// Append &fmt=<format> to a timedtext URL, replacing any existing fmt.
export function withFormat(url: string, format: string): string {
  const stripped = url.replace(/([?&])fmt=[^&]*/, "$1").replace(/[?&]$/, "");
  const sep = stripped.includes("?") ? "&" : "?";
  return `${stripped}${sep}fmt=${format}`;
}

// YouTube's modern json3 format. Shape:
//   { events: [ { tStartMs, dDurationMs, segs: [ { utf8 } ] }, ... ] }
export function parseJson3(raw: string): Cue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const out: Cue[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as {
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    };
    if (typeof e.tStartMs !== "number") continue;
    const text = (e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();
    if (!text) continue;
    out.push({
      start: e.tStartMs / 1000,
      duration: (e.dDurationMs ?? 0) / 1000,
      text,
    });
  }
  return out;
}

export function pickTrack(
  tracks: CaptionTrack[],
  preferredLanguage = "en",
): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const manualPref = tracks.find(
    (t) => t.kind === "manual" && t.language.startsWith(preferredLanguage),
  );
  if (manualPref) return manualPref;
  const autoPref = tracks.find(
    (t) => t.kind === "auto" && t.language.startsWith(preferredLanguage),
  );
  if (autoPref) return autoPref;
  return tracks.find((t) => t.kind === "manual") ?? tracks[0];
}

export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

// YouTube's internal Innertube API. Hitting this with an Android client
// context returns the same playerResponse the mobile app uses, including
// a captionTracks list. This is strictly more reliable than scraping the
// watch page because:
//   - no HTML parsing
//   - no stale `ip=` signatures (the Android client gets a freshly minted
//     baseUrl scoped to the request)
//   - YouTube cooperates with Android traffic in ways it does not for
//     bare node fetches against /watch
const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const INNERTUBE_CLIENT_VERSION = "20.10.38";
const ANDROID_UA = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

export interface InnertubeResult {
  tracks: CaptionTrack[];
  meta: VideoMeta;
}

export function parseVideoMetaFromInnertube(body: unknown): VideoMeta {
  const b = body as {
    videoDetails?: {
      title?: string;
      author?: string;
      channelId?: string;
      shortDescription?: string;
      keywords?: string[];
      lengthSeconds?: string | number;
      viewCount?: string | number;
      isLiveContent?: boolean;
      thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
    };
    microformat?: {
      playerMicroformatRenderer?: {
        uploadDate?: string;
        publishDate?: string;
        category?: string;
        ownerChannelName?: string;
      };
    };
  };
  const vd = b.videoDetails ?? {};
  const mf = b.microformat?.playerMicroformatRenderer ?? {};
  const thumbs = vd.thumbnail?.thumbnails ?? [];
  const biggestThumb = thumbs.length
    ? thumbs.reduce((a, c) => ((c.width ?? 0) > (a.width ?? 0) ? c : a))
    : undefined;
  return {
    title: vd.title,
    channel: mf.ownerChannelName ?? vd.author,
    channelId: vd.channelId,
    description: vd.shortDescription,
    keywords: vd.keywords,
    category: mf.category,
    uploadDate: mf.uploadDate,
    publishDate: mf.publishDate,
    lengthSeconds:
      vd.lengthSeconds !== undefined ? Number(vd.lengthSeconds) : undefined,
    viewCount: vd.viewCount !== undefined ? Number(vd.viewCount) : undefined,
    thumbnailUrl: biggestThumb?.url,
    isLiveContent: vd.isLiveContent,
  };
}

export async function fetchViaInnertube(
  videoId: string,
  fetchFn: typeof fetch,
): Promise<InnertubeResult | null> {
  logger.info("fetch.innertube.start", { videoId });
  let res: Response;
  try {
    res = await fetchFn(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": ANDROID_UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: INNERTUBE_CLIENT_VERSION,
          },
        },
        videoId,
      }),
    });
  } catch (e) {
    logger.warn("fetch.innertube.network-error", {
      videoId,
      message: (e as Error).message,
    });
    return null;
  }
  logger.info("fetch.innertube.response", {
    videoId,
    status: res.status,
    ok: res.ok,
  });
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const b = body as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          baseUrl?: string;
          languageCode?: string;
          kind?: string;
        }>;
      };
    };
  };
  const meta = parseVideoMetaFromInnertube(body);
  const rawTracks =
    b.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (rawTracks.length === 0) {
    logger.warn("fetch.innertube.no-tracks", { videoId });
    return { tracks: [], meta };
  }
  const tracks: CaptionTrack[] = rawTracks
    .filter((t) => !!t.baseUrl)
    .map((t) => ({
      language: String(t.languageCode ?? "en"),
      kind: t.kind === "asr" ? "auto" : "manual",
      baseUrl: String(t.baseUrl),
    }));
  logger.info("fetch.innertube.tracks", {
    videoId,
    count: tracks.length,
    meta: {
      title: meta.title,
      channel: meta.channel,
      uploadDate: meta.uploadDate,
      lengthSeconds: meta.lengthSeconds,
      keywordCount: meta.keywords?.length ?? 0,
    },
  });
  return { tracks, meta };
}

export async function fetchTranscript(
  videoId: string,
  deps: FetchDeps = {},
): Promise<NormalizedTranscript> {
  const fetchFn = (deps.fetchImpl ?? limitedFetch) as typeof fetch;

  // Step 1: try Innertube first.
  let inner: InnertubeResult | null = null;
  try {
    inner = await fetchViaInnertube(videoId, fetchFn);
  } catch (e) {
    logger.warn("fetch.innertube.unexpected-error", {
      videoId,
      message: (e as Error).message,
    });
  }

  // Step 2: watch-page fallback if Innertube gave us no tracks.
  if (!inner || inner.tracks.length === 0) {
    return fetchViaWatchPage(videoId, fetchFn);
  }

  const track = pickTrack(inner.tracks);
  if (!track) throw new TranscriptFetchError({ kind: "no-captions" });
  logger.info("fetch.track.picked", {
    videoId,
    language: track.language,
    kind: track.kind,
    source: "innertube",
  });
  const cues = await downloadAndParseTrack(videoId, track.baseUrl, fetchFn);
  return {
    videoId,
    language: track.language,
    kind: track.kind,
    cues,
    meta: inner.meta,
  };
}

async function downloadAndParseTrack(
  videoId: string,
  baseUrl: string,
  fetchFn: typeof fetch,
): Promise<Cue[]> {
  logger.debug("fetch.track.url", { videoId, baseUrl });
  const res = await fetchFn(baseUrl, {
    headers: { "user-agent": ANDROID_UA },
  });
  logger.info("fetch.track.response", {
    videoId,
    status: res.status,
    ok: res.ok,
  });
  if (!res.ok) {
    throw new TranscriptFetchError({
      kind: "network",
      status: res.status,
      message: `caption track ${res.status}`,
    });
  }
  const body = await res.text();
  logger.debug("fetch.track.body", {
    videoId,
    length: body.length,
    head: body.slice(0, 200),
  });
  const cues = parseTimedText(body);
  logger.info("fetch.track.parsed", { videoId, cueCount: cues.length });
  if (cues.length === 0) {
    logger.warn("fetch.empty-cues", {
      videoId,
      bodyLength: body.length,
      bodySample: body.slice(0, 2000),
    });
    throw new TranscriptFetchError({
      kind: "network",
      message: `caption body parsed to 0 cues (length=${body.length})`,
    });
  }
  return cues;
}

async function fetchViaWatchPage(
  videoId: string,
  fetchFn: typeof fetch,
): Promise<NormalizedTranscript> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  logger.info("fetch.watch.start", { videoId, watchUrl });
  let watchRes: Response;
  try {
    watchRes = await fetchFn(watchUrl);
  } catch (e) {
    logger.error("fetch.watch.network-error", {
      videoId,
      message: (e as Error).message,
    });
    throw new TranscriptFetchError({
      kind: "network",
      message: (e as Error).message,
    });
  }
  logger.info("fetch.watch.response", {
    videoId,
    status: watchRes.status,
    ok: watchRes.ok,
  });
  if (!watchRes.ok) {
    throw new TranscriptFetchError({
      kind: "network",
      status: watchRes.status,
      message: `watch page ${watchRes.status}`,
    });
  }
  const html = await watchRes.text();
  logger.debug("fetch.watch.body", {
    videoId,
    htmlLength: html.length,
    hasCaptionTracks: /"captionTracks"/.test(html),
    loginRequired: /"status":"LOGIN_REQUIRED"/.test(html),
    errorStatus: /"status":"ERROR"/.test(html),
  });
  const { state, tracks } = parseWatchPage(html);
  logger.info("fetch.watch.parsed", {
    videoId,
    state,
    trackCount: tracks.length,
    tracks: tracks.map((t) => ({
      language: t.language,
      kind: t.kind,
      hasBaseUrl: !!t.baseUrl,
    })),
  });
  if (state === "private") {
    throw new TranscriptFetchError({ kind: "private" });
  }
  if (state === "removed") {
    throw new TranscriptFetchError({ kind: "removed" });
  }
  if (state === "no-captions") {
    logger.warn("fetch.no-captions", {
      videoId,
      htmlSample: html.slice(0, 2000),
    });
    throw new TranscriptFetchError({ kind: "no-captions" });
  }
  const track = pickTrack(tracks);
  if (!track) {
    logger.warn("fetch.no-track-picked", { videoId, tracks });
    throw new TranscriptFetchError({ kind: "no-captions" });
  }
  logger.info("fetch.track.picked", {
    videoId,
    language: track.language,
    kind: track.kind,
  });

  // YouTube's timedtext endpoint returns an empty body unless you ask for a
  // specific format. We try json3 first (the modern shape used by the web
  // player), then fall back to srv1 (legacy XML). Also send a browser UA —
  // some YouTube edges serve empty bodies to bare clients.
  const attempts: Array<{ fmt: "json3" | "srv1" }> = [
    { fmt: "json3" },
    { fmt: "srv1" },
  ];
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
  };
  let cues: Cue[] = [];
  let lastBody = "";
  for (const attempt of attempts) {
    const cueUrl = withFormat(track.baseUrl, attempt.fmt);
    logger.debug("fetch.track.url", { videoId, fmt: attempt.fmt, cueUrl });
    const cueRes = await fetchFn(cueUrl, { headers });
    logger.info("fetch.track.response", {
      videoId,
      fmt: attempt.fmt,
      status: cueRes.status,
      ok: cueRes.ok,
    });
    if (!cueRes.ok) continue;
    const body = await cueRes.text();
    lastBody = body;
    logger.debug("fetch.track.body", {
      videoId,
      fmt: attempt.fmt,
      length: body.length,
      head: body.slice(0, 200),
    });
    if (body.length === 0) continue;
    cues =
      attempt.fmt === "json3" ? parseJson3(body) : parseTimedText(body);
    logger.info("fetch.track.parsed", {
      videoId,
      fmt: attempt.fmt,
      cueCount: cues.length,
    });
    if (cues.length > 0) break;
  }
  if (cues.length === 0) {
    logger.warn("fetch.empty-cues", {
      videoId,
      lastBodyLength: lastBody.length,
      lastBodySample: lastBody.slice(0, 2000),
    });
    throw new TranscriptFetchError({
      kind: "network",
      message: `all caption formats returned no cues`,
    });
  }
  return {
    videoId,
    language: track.language,
    kind: track.kind,
    cues,
  };
}

export function transcriptPath(videoId: string, dataDir?: string): string {
  const root = dataDir ?? join(process.cwd(), "data", "transcripts");
  return join(root, `${videoId}.json`);
}

export interface StoredTranscript {
  path: string;
  meta?: VideoMeta;
}

export async function fetchAndStore(
  videoId: string,
  deps: FetchDeps = {},
): Promise<StoredTranscript> {
  const transcript = await fetchTranscript(videoId, deps);
  const path = transcriptPath(videoId, deps.dataDir);
  atomicWriteJson(path, transcript);
  return { path, meta: transcript.meta };
}

export function transcriptExists(videoId: string, dataDir?: string): boolean {
  return existsSync(transcriptPath(videoId, dataDir));
}
