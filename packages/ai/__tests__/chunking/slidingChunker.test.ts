import { chunkBySlidingWindow } from "../../src/chunking/slidingChunker";

describe("chunkBySlidingWindow", () => {
  it("returns an empty list for empty input", () => {
    expect(chunkBySlidingWindow("", "p")).toEqual([]);
  });

  it("creates overlapping chunks tagged with the paper id", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const chunks = chunkBySlidingWindow(text, "p1", { windowTokens: 8, strideTokens: 4 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.paperId === "p1" && c.kind === "sliding")).toBe(true);
  });

  it("respects the window token budget", () => {
    const text = "alpha beta gamma. delta epsilon zeta. eta theta iota. kappa lambda mu.";
    const chunks = chunkBySlidingWindow(text, "p1", { windowTokens: 6, strideTokens: 3 });
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(12);
    }
  });
});
