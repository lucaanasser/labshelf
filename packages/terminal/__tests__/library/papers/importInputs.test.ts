import { identifiersIn } from "../../../src/library/papers/importInputs";

describe("identifiersIn", () => {
  it("reads a bare arXiv id, dropping the version", () => {
    expect(identifiersIn("1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
    expect(identifiersIn("  1706.03762v5 ")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
  });

  it("reads a bare DOI", () => {
    expect(identifiersIn("10.1038/nature12373")).toEqual([{ type: "doi", value: "10.1038/nature12373" }]);
  });

  it("finds identifiers inside URLs and labelled text", () => {
    expect(identifiersIn("https://doi.org/10.1038/nature12373")).toEqual([{ type: "doi", value: "10.1038/nature12373" }]);
    expect(identifiersIn("arXiv:1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
    expect(identifiersIn("https://arxiv.org/abs/1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
  });

  it("returns nothing for text without identifiers", () => {
    expect(identifiersIn("hello world")).toEqual([]);
    expect(identifiersIn("https://example.org/files/paper.pdf")).toEqual([]);
  });
});
