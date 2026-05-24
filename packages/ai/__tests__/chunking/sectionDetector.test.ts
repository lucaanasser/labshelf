import { detectSections } from "../../src/chunking/sectionDetector";

describe("detectSections", () => {
  it("finds numbered headings and assigns ranges", () => {
    const pages = [
      {
        page: 1,
        text: [
          "1 Introduction",
          "Some introductory text spanning a paragraph.",
          "2 Related Work",
          "Earlier results discussed here.",
          "3 Method",
          "The proposed approach is...",
        ].join("\n"),
      },
    ];
    const sections = detectSections(pages);
    expect(sections.map((s) => s.heading)).toEqual([
      "1 Introduction",
      "2 Related Work",
      "3 Method",
    ]);
    expect(sections[0]!.endOffset).toBeGreaterThan(sections[0]!.startOffset);
  });

  it("recognises named sections without numbering", () => {
    const pages = [
      { page: 1, text: "Abstract\nThis paper introduces..." },
      { page: 2, text: "Introduction\nWe propose..." },
      { page: 3, text: "References\n[1] ..." },
    ];
    const sections = detectSections(pages);
    expect(sections.map((s) => s.heading)).toEqual(
      expect.arrayContaining(["Abstract", "Introduction", "References"]),
    );
  });

  it("returns empty when no headings match", () => {
    const pages = [{ page: 1, text: "just running text with no headings at all" }];
    expect(detectSections(pages)).toEqual([]);
  });
});
