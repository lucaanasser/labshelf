import { extractCompute } from "../../src/heuristics/computeExtractor";

describe("extractCompute", () => {
  it("parses count, model and hours", () => {
    const result = extractCompute("Trained on 8 x A100 GPUs over 240 GPU-hours.");
    expect(result?.acceleratorCount).toBe(8);
    expect(result?.acceleratorModel).toBe("A100");
    expect(result?.trainingHours).toBe(240);
    expect(result?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("returns undefined when no compute is mentioned", () => {
    expect(extractCompute("a paper about poetry")).toBeUndefined();
  });

  it("handles H100", () => {
    const result = extractCompute("1024 × H100");
    expect(result?.acceleratorModel).toBe("H100");
    expect(result?.acceleratorCount).toBe(1024);
  });
});
