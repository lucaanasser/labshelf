import { detectMethods } from "../../src/heuristics/methodDetector";

describe("detectMethods", () => {
  it("matches canonical training paradigms", () => {
    const text = "We pre-train with masked language modeling (MLM) and fine-tune with RLHF.";
    const tags = detectMethods(text);
    expect(tags).toEqual(
      expect.arrayContaining([
        "fine-tuning",
        "masked-language-modeling",
        "pre-training",
        "reinforcement-learning",
      ]),
    );
  });

  it("detects contrastive learning aliases", () => {
    const tags = detectMethods("our SimCLR-style contrastive pre-training");
    expect(tags).toContain("contrastive");
  });

  it("returns an empty list when no method is mentioned", () => {
    expect(detectMethods("a paper about literary criticism")).toEqual([]);
  });
});
