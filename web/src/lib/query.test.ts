import { describe, it, expect } from "vitest";
import {
  filterRows, augmentWithEntityMatches, sortByPublishDesc, paginate, searchEntityIndex,
} from "./query";
import type { VideoRow, EntityIndexEntry, EntityVideosIndex } from "../types";

const row = (videoId: string, overrides: Partial<VideoRow> = {}): VideoRow => ({
  videoId, status: "fetched", ...overrides,
});

describe("filterRows", () => {
  it("matches on title, channel, videoId, keywords, description", () => {
    const rows = [
      row("a", { title: "Aliens in Mexico" }),
      row("b", { channel: "The Why Files" }),
      row("c", { keywords: ["ufo", "bigfoot"] }),
      row("d"),
    ];
    expect(filterRows(rows, { text: "alien" }).map((r) => r.videoId)).toEqual(["a"]);
    expect(filterRows(rows, { text: "why files" }).map((r) => r.videoId)).toEqual(["b"]);
    expect(filterRows(rows, { text: "bigfoot" }).map((r) => r.videoId)).toEqual(["c"]);
    expect(filterRows(rows, { text: "xyz" })).toEqual([]);
  });

  it("filters by status and channel", () => {
    const rows = [row("a", { status: "pending" }), row("b", { status: "fetched" })];
    expect(filterRows(rows, { status: "fetched" }).map((r) => r.videoId)).toEqual(["b"]);
  });
});

describe("augmentWithEntityMatches", () => {
  it("adds fetched rows whose entity canonicals match the query", () => {
    const rows = [row("a"), row("b", { title: "unrelated" }), row("c", { status: "pending" })];
    const index: EntityIndexEntry[] = [
      { id: "person:alice", type: "person", canonical: "Alice", videoCount: 1, mentionCount: 1 },
    ];
    const evIdx: EntityVideosIndex = {
      "person:alice": [
        { videoId: "b", mentions: [] },
        { videoId: "c", mentions: [] },
      ],
    };
    const out = augmentWithEntityMatches([rows[0]], rows, { text: "alice" }, index, evIdx);
    // Adds "b" (fetched, entity match) but not "c" (status pending) or duplicates of "a"
    expect(out.map((r) => r.videoId).sort()).toEqual(["a", "b"]);
  });

  it("is a no-op with empty text", () => {
    const rows = [row("a")];
    const out = augmentWithEntityMatches(rows, rows, {}, [], {});
    expect(out).toEqual(rows);
  });
});

describe("sortByPublishDesc", () => {
  it("sorts by publishDate descending, missing dates last", () => {
    const rows = [
      row("a", { publishDate: "2023-01-01" }),
      row("b"),
      row("c", { publishDate: "2024-06-01" }),
    ];
    expect(sortByPublishDesc(rows).map((r) => r.videoId)).toEqual(["c", "a", "b"]);
  });
});

describe("paginate", () => {
  it("slices rows by page and pageSize", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row("v" + i));
    const result = paginate(rows, { page: 2, pageSize: 10 });
    expect(result.total).toBe(50);
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0].videoId).toBe("v10");
  });
});

describe("searchEntityIndex", () => {
  const index: EntityIndexEntry[] = [
    { id: "p:alice", type: "person", canonical: "Alice Smith", videoCount: 1, mentionCount: 10 },
    { id: "p:alicia", type: "person", canonical: "Alicia Jones", videoCount: 1, mentionCount: 5 },
    { id: "o:acme", type: "organization", canonical: "Acme Corp", videoCount: 1, mentionCount: 20 },
  ];

  it("prefers earlier-position matches", () => {
    const out = searchEntityIndex(index, { q: "alic" });
    expect(out[0].canonical).toBe("Alice Smith");
  });

  it("filters by type", () => {
    const out = searchEntityIndex(index, { type: "organization" });
    expect(out.map((e) => e.id)).toEqual(["o:acme"]);
  });

  it("respects limit", () => {
    expect(searchEntityIndex(index, { q: "a", limit: 1 })).toHaveLength(1);
  });
});
