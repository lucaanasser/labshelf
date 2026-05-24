import { scorePageDifficulty } from "../../src/heuristics/difficultyScorer";

describe("scorePageDifficulty", () => {
  it("returns zero for empty input", () => {
    expect(scorePageDifficulty("")).toBe(0);
  });

  it("rates equation-heavy text higher than prose", () => {
    const easy = "We propose a simple method. The model works on many tasks.";
    const dense = "$L = -\\sum p(x) \\log q(x)$. $\\nabla_\\theta L = \\frac{\\partial L}{\\partial \\theta}$. $\\int_{0}^{1} f(x) dx$. $\\sqrt{n}$.";
    expect(scorePageDifficulty(dense)).toBeGreaterThan(scorePageDifficulty(easy));
  });

  it("returns a value in [0,1]", () => {
    const score = scorePageDifficulty("Some plain text with a few words.");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
