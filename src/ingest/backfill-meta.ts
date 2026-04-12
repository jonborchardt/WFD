// Meta backfill.
//
// Walk fetched catalog rows whose metadata pre-dates the microformat fix
// and refresh only the meta (no transcript re-download). Runs in the
// background on boot, non-blocking.

import { Catalog, VideoMeta } from "../catalog/catalog.js";
import { limitedFetch } from "./rate-limiter.js";
import { fetchViaInnertube, fetchMicroformatViaWeb } from "./transcript.js";
import { logger } from "../shared/logger.js";

export interface BackfillProgress {
  running: boolean;
  total: number;
  done: number;
  failed: number;
}

export class MetaBackfiller {
  private progress: BackfillProgress = {
    running: false,
    total: 0,
    done: 0,
    failed: 0,
  };
  private loopPromise: Promise<void> | null = null;

  constructor(private catalog: Catalog) {}

  snapshot(): BackfillProgress {
    return { ...this.progress };
  }

  // Rows considered "needs backfill": fetched, no uploadDate yet.
  private candidates() {
    return this.catalog
      .all()
      .filter((r) => r.status === "fetched" && !r.uploadDate);
  }

  start(): Promise<void> {
    if (this.loopPromise) return this.loopPromise;
    this.loopPromise = this.run().finally(() => {
      this.loopPromise = null;
    });
    return this.loopPromise;
  }

  private async run(): Promise<void> {
    const rows = this.candidates();
    if (rows.length === 0) {
      logger.info("backfill.skip", { reason: "nothing to do" });
      return;
    }
    logger.info("backfill.start", { total: rows.length });
    this.progress = { running: true, total: rows.length, done: 0, failed: 0 };
    for (const row of rows) {
      try {
        const [inner, webMeta] = await Promise.all([
          fetchViaInnertube(row.videoId, limitedFetch),
          fetchMicroformatViaWeb(row.videoId, limitedFetch).catch(() => null),
        ]);
        const merged: VideoMeta = {
          ...(inner?.meta ?? {}),
          ...(webMeta ?? {}),
        };
        // Preserve android-rich fields on clashes.
        if (inner?.meta.title) merged.title = inner.meta.title;
        if (inner?.meta.channel) merged.channel = inner.meta.channel;
        if (inner?.meta.description) merged.description = inner.meta.description;
        if (inner?.meta.keywords) merged.keywords = inner.meta.keywords;
        if (inner?.meta.viewCount !== undefined) merged.viewCount = inner.meta.viewCount;
        if (inner?.meta.lengthSeconds !== undefined) merged.lengthSeconds = inner.meta.lengthSeconds;
        if (inner?.meta.thumbnailUrl) merged.thumbnailUrl = inner.meta.thumbnailUrl;
        this.catalog.update(row.videoId, merged);
        logger.info("backfill.row.success", {
          videoId: row.videoId,
          uploadDate: merged.uploadDate,
          publishDate: merged.publishDate,
        });
        this.progress = { ...this.progress, done: this.progress.done + 1 };
      } catch (e) {
        logger.warn("backfill.row.failure", {
          videoId: row.videoId,
          message: (e as Error).message,
        });
        this.progress = { ...this.progress, failed: this.progress.failed + 1 };
      }
    }
    logger.info("backfill.finish", {
      done: this.progress.done,
      failed: this.progress.failed,
    });
    this.progress = { ...this.progress, running: false };
  }
}
