import { describe, it, expect } from "vitest";
import { canonicalizeNerMentions } from "../src/nlp/canonicalize.ts";
import type { NerMention } from "../src/nlp/ner.ts";

function per(surface: string, start = 0): NerMention {
  return { type: "person", surface, start, end: start + surface.length, score: 0.99 };
}
function loc(surface: string, start = 0): NerMention {
  return { type: "location", surface, start, end: start + surface.length, score: 0.99 };
}

describe("canonicalize ner mentions", () => {
  it("drops PERSON stopwords like God/Dad/Sir", () => {
    const out = canonicalizeNerMentions(
      [per("God"), per("Dad"), per("Angela Merkel")],
      { transcriptId: "v1" },
    );
    expect(out.length).toBe(1);
    expect(out[0].canonical).toBe("Angela Merkel");
  });

  it("binds unambiguous first names to a same-transcript full name", () => {
    const out = canonicalizeNerMentions(
      [per("Dan Brown", 0), per("Dan", 20)],
      { transcriptId: "v1" },
    );
    const dans = out.filter((m) => (m.canonical ?? m.surface).includes("Dan Brown"));
    expect(dans.length).toBe(2);
  });

  it("scopes ambiguous first names with the transcript id", () => {
    const out = canonicalizeNerMentions(
      [per("Dan Brown", 0), per("Dan Rather", 20), per("Dan", 40)],
      { transcriptId: "v42" },
    );
    const bare = out.find((m) => m.surface === "Dan");
    expect(bare!.canonical).toBe("Dan #v42");
  });

  it("scopes unbound first names per-transcript when no long form exists", () => {
    const out = canonicalizeNerMentions([per("Dan", 0)], { transcriptId: "v7" });
    expect(out[0].canonical).toBe("Dan #v7");
  });

  it("collapses US / America / United States to one canonical location", () => {
    const out = canonicalizeNerMentions(
      [loc("US", 0), loc("America", 10), loc("United States", 20)],
      { transcriptId: "v1" },
    );
    expect(out.every((m) => m.canonical === "United States")).toBe(true);
  });

  it("passes through organizations unchanged", () => {
    const orgs: NerMention[] = [
      { type: "organization", surface: "NASA", start: 0, end: 4, score: 0.99 },
    ];
    const out = canonicalizeNerMentions(orgs, { transcriptId: "v1" });
    expect(out[0].canonical).toBeUndefined();
    expect(out[0].surface).toBe("NASA");
  });
});
