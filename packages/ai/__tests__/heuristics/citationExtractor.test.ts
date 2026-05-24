import { extractCitations } from "../../src/heuristics/citationExtractor";

describe("extractCitations", () => {
  it("parses numeric marks including comma lists", () => {
    const marks = extractCitations("prior work [12] and recent results [3, 7, 11] support this.");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.numbers).toEqual([12]);
    expect(marks[1]!.numbers).toEqual([3, 7, 11]);
  });

  it("parses author-year citations", () => {
    const marks = extractCitations("recent work (Vaswani et al., 2017) introduced...");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.kind).toBe("authorYear");
    expect(marks[0]!.year).toBe(2017);
  });

  it("returns empty for plain text", () => {
    expect(extractCitations("no citations here")).toEqual([]);
  });
});
