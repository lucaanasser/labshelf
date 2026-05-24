import { scoreReproducibility } from "../../src/heuristics/reproScorer";

describe("scoreReproducibility", () => {
  it("assigns ten for fully reproducible papers", () => {
    const text = `
      Code is released at github.com/x/y. The dataset is publicly available.
      We use learning rate 1e-4, batch size 32, AdamW optimizer.
      Random seed 42; results averaged over three seeds.
      Training on 8 A100 GPUs.
    `;
    expect(scoreReproducibility(text).score).toBe(10);
  });

  it("returns zero on a bare summary", () => {
    expect(scoreReproducibility("we propose a new method that works.").score).toBe(0);
  });

  it("partial credit on partial disclosure", () => {
    const text = "Code is released at github.com/x/y. We use random seed 42.";
    const result = scoreReproducibility(text);
    expect(result.hasCode).toBe(true);
    expect(result.hasSeeds).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(4);
  });
});
