import type { PaperRecord } from "@labshelf/core";

import { crumbs, formatBytes, paperLink, relativeTime, shortAuthors, venueLine } from "../../src/ui/format";

function record(extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "A paper", path: "/lib/papers/p1", citeKey: "p1", status: "unread", ...extra };
}

describe("relativeTime", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const ago = (ms: number): string => new Date(now - ms).toISOString();
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("says never when there is no timestamp", () => {
    expect(relativeTime(undefined, now)).toBe("never");
    expect(relativeTime("", now)).toBe("never");
  });

  it("says never for an unparseable timestamp", () => {
    expect(relativeTime("yesterday-ish", now)).toBe("never");
  });

  it("says just now for the first 45 seconds", () => {
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(10 * SECOND), now)).toBe("just now");
    expect(relativeTime(ago(44 * SECOND), now)).toBe("just now");
  });

  it("says just now for a timestamp in the future (clock skew)", () => {
    expect(relativeTime(new Date(now + 5 * MINUTE).toISOString(), now)).toBe("just now");
  });

  it("counts minutes", () => {
    expect(relativeTime(ago(45 * SECOND), now)).toBe("1 min ago");
    expect(relativeTime(ago(5 * MINUTE), now)).toBe("5 min ago");
    expect(relativeTime(ago(59 * MINUTE), now)).toBe("59 min ago");
  });

  it("counts hours", () => {
    expect(relativeTime(ago(60 * MINUTE), now)).toBe("1 h ago");
    expect(relativeTime(ago(3 * HOUR), now)).toBe("3 h ago");
    expect(relativeTime(ago(23 * HOUR), now)).toBe("23 h ago");
  });

  it("counts days", () => {
    expect(relativeTime(ago(24 * HOUR), now)).toBe("1 d ago");
    expect(relativeTime(ago(2 * DAY), now)).toBe("2 d ago");
    expect(relativeTime(ago(29 * DAY), now)).toBe("29 d ago");
  });

  it("switches to the date after 30 days", () => {
    expect(relativeTime(ago(30 * DAY), now)).toBe(new Date(now - 30 * DAY).toISOString().slice(0, 10));
    expect(relativeTime("2025-01-15T08:30:00.000Z", now)).toBe("2025-01-15");
  });

  it("uses the current time by default", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 2 * HOUR).toISOString())).toBe("2 h ago");
  });
});

describe("formatBytes", () => {
  it("shows plain bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("rounds to whole kilobytes below 1 MB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(812 * 1024)).toBe("812 KB");
  });

  it("shows one decimal for megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(Math.round(2.4 * 1024 * 1024))).toBe("2.4 MB");
    expect(formatBytes(120 * 1024 * 1024)).toBe("120.0 MB");
  });
});

describe("shortAuthors", () => {
  it("is empty without authors", () => {
    expect(shortAuthors(undefined)).toBe("");
    expect(shortAuthors([])).toBe("");
  });

  it("uses the last word of a natural-order name", () => {
    expect(shortAuthors(["Ashish Vaswani"])).toBe("Vaswani");
  });

  it("uses the part before the comma of an inverted name", () => {
    expect(shortAuthors(["Vaswani, Ashish"])).toBe("Vaswani");
    expect(shortAuthors(["  Vaswani , Ashish"])).toBe("Vaswani");
  });

  it("mixes both name styles", () => {
    expect(shortAuthors(["Vaswani, Ashish", "Noam Shazeer"])).toBe("Vaswani, Shazeer");
  });

  it("keeps up to three authors by default", () => {
    expect(shortAuthors(["A One", "B Two", "C Three"])).toBe("One, Two, Three");
  });

  it("adds et al. beyond the limit", () => {
    expect(shortAuthors(["A One", "B Two", "C Three", "D Four"])).toBe("One, Two, Three et al.");
  });

  it("honors a custom limit", () => {
    expect(shortAuthors(["A One", "B Two"], 1)).toBe("One et al.");
    expect(shortAuthors(["A One"], 1)).toBe("One");
    expect(shortAuthors(["A One", "B Two", "C Three"], 2)).toBe("One, Two et al.");
  });

  it("handles a single-word name and surrounding spaces", () => {
    expect(shortAuthors(["Plato"])).toBe("Plato");
    expect(shortAuthors(["  Ada   Lovelace  "])).toBe("Lovelace");
  });
});

describe("venueLine", () => {
  it("joins venue, year, volume(issue) and pages", () => {
    expect(venueLine(record({ journal: "Nature", year: 2017, volume: "12", issue: "3", pages: "45–67" })))
      .toBe("Nature · 2017 · 12(3) · pp. 45–67");
  });

  it("shows the volume without an issue", () => {
    expect(venueLine(record({ journal: "Nature", volume: "12" }))).toBe("Nature · 12");
  });

  it("ignores an issue without a volume", () => {
    expect(venueLine(record({ journal: "Nature", issue: "3" }))).toBe("Nature");
  });

  it("falls back to the publisher when there is no journal", () => {
    expect(venueLine(record({ publisher: "MIT Press", year: 2016 }))).toBe("MIT Press · 2016");
  });

  it("prefers the journal over the publisher", () => {
    expect(venueLine(record({ journal: "Nature", publisher: "Springer" }))).toBe("Nature");
  });

  it("shows just the year when that is all there is", () => {
    expect(venueLine(record({ year: 2017 }))).toBe("2017");
  });

  it("is empty when nothing is known", () => {
    expect(venueLine(record())).toBe("");
  });
});

describe("paperLink", () => {
  it("builds a doi.org link from the DOI", () => {
    expect(paperLink(record({ doi: "10.5555/3295222.3295349" }))).toBe("https://doi.org/10.5555/3295222.3295349");
  });

  it("falls back to the stored URL", () => {
    expect(paperLink(record({ url: "https://arxiv.org/abs/1706.03762" }))).toBe("https://arxiv.org/abs/1706.03762");
  });

  it("prefers the DOI over the URL", () => {
    expect(paperLink(record({ doi: "10.1/x", url: "https://example.org/x" }))).toBe("https://doi.org/10.1/x");
  });

  it("is undefined without either", () => {
    expect(paperLink(record())).toBeUndefined();
  });
});

describe("crumbs", () => {
  it("starts with papers and adds each folder", () => {
    expect(crumbs("")).toEqual(["papers"]);
    expect(crumbs("ML")).toEqual(["papers", "ML"]);
    expect(crumbs("ML/Transformers")).toEqual(["papers", "ML", "Transformers"]);
  });

  it("ignores stray slashes", () => {
    expect(crumbs("/ML//Transformers/")).toEqual(["papers", "ML", "Transformers"]);
  });
});

describe("formatBytes regressions", () => {
  it("switches to MB instead of showing 1024 KB", () => {
    expect(formatBytes(1048575)).toBe("1.0 MB");
    expect(formatBytes(1023 * 1024)).toBe("1023 KB");
  });
});
