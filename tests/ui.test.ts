import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../src/catalog/catalog.js";
import { atomicWriteJson } from "../src/ingest/transcript.js";
import {
  filterRows,
  paginate,
  renderListPage,
  renderDetailPage,
  renderEmptyState,
  loadTranscript,
  searchTranscriptLines,
  deepLink,
  formatTime,
  escapeHtml,
} from "../src/ui/server.ts";

function seedCatalog(): Catalog {
  const dir = mkdtempSync(join(tmpdir(), "captions-ui-"));
  const cat = new Catalog(join(dir, "catalog.json"));
  cat.upsert({
    videoId: "aaaaaaaaaaa",
    sourceUrl: "https://y/aaaaaaaaaaa",
    title: "Alpha debate",
    channel: "ChannelOne",
    status: "fetched",
    attempts: 1,
    transcriptPath: join(dir, "aaaaaaaaaaa.json"),
    fetchedAt: "2026-04-10T12:00:00Z",
  });
  cat.upsert({
    videoId: "bbbbbbbbbbb",
    sourceUrl: "https://y/bbbbbbbbbbb",
    title: "Beta interview",
    channel: "ChannelTwo",
    status: "pending",
    attempts: 0,
  });
  cat.upsert({
    videoId: "ccccccccccc",
    sourceUrl: "https://y/ccccccccccc",
    title: "Gamma rally",
    channel: "ChannelOne",
    status: "failed-needs-user",
    attempts: 3,
  });
  atomicWriteJson(join(dir, "aaaaaaaaaaa.json"), {
    videoId: "aaaaaaaaaaa",
    language: "en",
    kind: "manual",
    cues: [
      { start: 0, duration: 2, text: "opening statement" },
      { start: 10, duration: 3, text: "rebuttal about policy" },
    ],
  });
  return cat;
}

describe("list view", () => {
  it("renders seeded rows", () => {
    const cat = seedCatalog();
    const html = renderListPage(paginate(cat.all(), {}), {});
    expect(html).toContain("Alpha debate");
    expect(html).toContain("Beta interview");
    expect(html).toContain("Gamma rally");
  });

  it("empty catalog shows empty state", () => {
    expect(renderEmptyState("empty")).toContain("No videos");
  });

  it("loading + error states render", () => {
    expect(renderEmptyState("loading")).toContain("Loading");
    expect(renderEmptyState("error", "boom")).toContain("boom");
  });
});

describe("search filters", () => {
  it("free text narrows results", () => {
    const cat = seedCatalog();
    const filtered = filterRows(cat.all(), { text: "debate" });
    expect(filtered.map((r) => r.videoId)).toEqual(["aaaaaaaaaaa"]);
  });
  it("channel + status compose", () => {
    const cat = seedCatalog();
    const filtered = filterRows(cat.all(), {
      channel: "ChannelOne",
      status: "failed-needs-user",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].videoId).toBe("ccccccccccc");
  });
});

describe("detail view", () => {
  it("loads transcript and renders timestamps", () => {
    const cat = seedCatalog();
    const row = cat.get("aaaaaaaaaaa")!;
    const transcript = loadTranscript(row);
    const html = renderDetailPage(row, transcript);
    expect(html).toContain("opening statement");
    expect(html).toContain("[00:10]");
  });

  it("produces a click-through deep link at the right timestamp", () => {
    const link = deepLink("aaaaaaaaaaa", 10);
    expect(link).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa&t=10s");
  });

  it("missing transcript renders a fallback", () => {
    const cat = seedCatalog();
    const row = cat.get("bbbbbbbbbbb")!;
    const html = renderDetailPage(row, null);
    expect(html).toContain("No transcript");
  });
});

describe("helpers", () => {
  it("searchTranscriptLines returns matching cues", () => {
    const lines = searchTranscriptLines(
      { cues: [{ text: "policy point", start: 1, duration: 1 }] },
      "POLICY",
    );
    expect(lines).toHaveLength(1);
  });
  it("formatTime prints mm:ss", () => {
    expect(formatTime(75)).toBe("01:15");
  });
  it("escapeHtml defangs tags", () => {
    expect(escapeHtml('<script>"&\'')).toBe(
      "&lt;script&gt;&quot;&amp;&#39;",
    );
  });
});
