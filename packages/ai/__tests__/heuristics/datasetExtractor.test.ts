import { detectDatasets } from "../../src/heuristics/datasetExtractor";

describe("detectDatasets", () => {
  it("recognises common benchmarks", () => {
    const text = "We evaluate on GLUE, SuperGLUE and MS-MARCO; pretrained on The Pile.";
    expect(detectDatasets(text)).toEqual(
      expect.arrayContaining(["GLUE", "MS-MARCO", "SuperGLUE", "The Pile"]),
    );
  });

  it("returns sorted unique tags", () => {
    const tags = detectDatasets("ImageNet, then again ImageNet, plus CIFAR-10.");
    expect(tags).toEqual(["CIFAR-10", "ImageNet"]);
  });

  it("returns empty when no benchmark is mentioned", () => {
    expect(detectDatasets("a literary paper about Borges")).toEqual([]);
  });
});
