// YouTube transcript fetcher.
//
// Every network call goes through the rate-limited fetch; a raw fetch is never
// imported here. Writes are atomic: we write to <path>.tmp, fsync, then rename.

import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { limitedFetch } from "./rate-limiter.js";
import { logger } from "../shared/logger.js";

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

// Parse YouTube's timedtext XML. Deliberately tiny — enough for well-formed
// <text start="..." dur="...">...</text> payloads.
export function parseTimedText(xml: string): Cue[] {
  const cues: Cue[] = [];
  const re = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
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
export function parseWatchPage(html: string): {
  state: "ok" | "private" | "removed" | "no-captions";
  tracks: CaptionTrack[];
} {
  if (/"status":"LOGIN_REQUIRED"/.test(html) || /video is private/i.test(html)) {
    return { state: "private", tracks: [] };
  }
  if (/"status":"ERROR"/.test(html) || /video unavailable/i.test(html)) {
    return { state: "removed", tracks: [] };
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

export async function fetchTranscript(
  videoId: string,
  deps: FetchDeps = {},
): Promise<NormalizedTranscript> {
  const fetchFn = (deps.fetchImpl ?? limitedFetch) as typeof fetch;
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

  const cueRes = await fetchFn(track.baseUrl);
  logger.info("fetch.track.response", {
    videoId,
    status: cueRes.status,
    ok: cueRes.ok,
  });
  if (!cueRes.ok) {
    throw new TranscriptFetchError({
      kind: "network",
      status: cueRes.status,
      message: `caption track ${cueRes.status}`,
    });
  }
  const xml = await cueRes.text();
  logger.debug("fetch.track.body", { videoId, xmlLength: xml.length });
  const cues = parseTimedText(xml);
  logger.info("fetch.track.parsed", { videoId, cueCount: cues.length });
  if (cues.length === 0) {
    logger.warn("fetch.empty-cues", {
      videoId,
      xmlSample: xml.slice(0, 2000),
    });
    throw new TranscriptFetchError({ kind: "no-captions" });
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

export async function fetchAndStore(
  videoId: string,
  deps: FetchDeps = {},
): Promise<string> {
  const transcript = await fetchTranscript(videoId, deps);
  const path = transcriptPath(videoId, deps.dataDir);
  atomicWriteJson(path, transcript);
  return path;
}

export function transcriptExists(videoId: string, dataDir?: string): boolean {
  return existsSync(transcriptPath(videoId, dataDir));
}
