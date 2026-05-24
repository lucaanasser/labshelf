import { chunkBySection } from "../../src/chunking/sectionChunker";
import type { ExtractedPdfText } from "../../src/types/chunk";

function makeExtracted(text: string): ExtractedPdfText {
  return {
    paperId: "p1",
    pages: [{ page: 1, text }],
    sections: [],
  };
}

describe("chunkBySection", () => {
  it("emits one chunk per detected section when each fits the budget", () => {
    const extracted = makeExtracted("1 Intro\nshort intro.\n2 Method\nshort method body.");
    const chunks = chunkBySection(extracted);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.kind === "section")).toBe(true);
  });

  it("splits oversized sections on paragraph boundaries", () => {
    const para = "lorem ipsum ".repeat(200);
    const extracted = makeExtracted(`1 Big\n${para}\n\n${para}\n\n${para}`);
    const chunks = chunkBySection(extracted, { maxTokensPerChunk: 64 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(64 * 2);
    }
  });

  it("falls back to page chunking when no sections are detected", () => {
    const extracted: ExtractedPdfText = {
      paperId: "p1",
      pages: [
        { page: 1, text: "no headings here" },
        { page: 2, text: "still no headings" },
      ],
      sections: [],
    };
    const chunks = chunkBySection(extracted);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.page).toBe(1);
  });
});
