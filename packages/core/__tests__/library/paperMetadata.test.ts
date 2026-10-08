import { paperRecordFromMetadata, parsePaperMetadata } from "@labshelf/core";

const location = { id: "vaswani2017", path: "/lib/papers/ml/vaswani2017", hasPdf: true };

describe("parsePaperMetadata", () => {
  it("returns the mapping, or undefined for anything else", () => {
    expect(parsePaperMetadata("title: A\nyear: 2017\n")).toEqual({ title: "A", year: 2017 });
    expect(parsePaperMetadata("- a\n- b\n")).toBeUndefined();
    expect(parsePaperMetadata("title: [unclosed")).toBeUndefined();
    expect(parsePaperMetadata("")).toBeUndefined();
  });
});

describe("paperRecordFromMetadata (same rules as the VS Code LibraryIndexer)", () => {
  it("maps every field and takes the id and PDF presence from the folder", () => {
    const record = paperRecordFromMetadata({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", 3, "Noam Shazeer"],
      year: 2017,
      citekey: "vaswani2017",
      status: "reading",
      journal: "NeurIPS",
      doi: "10.5555/3295222",
      keywords: ["transformers"],
      tags: ["nlp", ""],
      note: "great",
      textLayer: { state: "native", checkedAt: "2026-01-01" },
      hasPdf: false,
      path: "/somewhere/else",
    }, location);
    expect(record).toMatchObject({
      id: "vaswani2017",
      path: "/lib/papers/ml/vaswani2017",
      hasPdf: true,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      status: "reading",
      journal: "NeurIPS",
      doi: "10.5555/3295222",
      keywords: ["transformers"],
      note: "great",
      textLayer: { state: "native" },
    });
    expect(record.tags).toEqual(["nlp", ""]);
  });

  it("falls back to the folder name for title and citekey and to unread for an unknown status", () => {
    const record = paperRecordFromMetadata({ status: "archived", year: "2017" }, { ...location, hasPdf: false });
    expect(record.title).toBe("vaswani2017");
    expect(record.citeKey).toBe("vaswani2017");
    expect(record.status).toBe("unread");
    expect(record.year).toBeUndefined();
    expect(record.hasPdf).toBe(false);
  });
});
