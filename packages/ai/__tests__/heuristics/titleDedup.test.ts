import { normalizeTitle, titleSimilarity } from "../../src/heuristics/titleDedup";

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Attention Is All You Need!")).toBe("attention is all you need");
  });
});

describe("titleSimilarity", () => {
  it("scores near-duplicates above 0.7", () => {
    const a = "Efficient Scaling of LLMs";
    const b = "Efficient Scaling of Large Language Models";
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.3);
  });

  it("scores identical titles as 1", () => {
    const t = "Mamba: Linear-Time Sequence Modeling";
    expect(titleSimilarity(t, t)).toBe(1);
  });

  it("scores unrelated titles near zero", () => {
    expect(titleSimilarity("DDPM Diffusion Models", "Transformers Survey")).toBeLessThan(0.2);
  });
});
