import { normalizeTags } from "@labshelf/core";

describe("normalizeTags", () => {
  it("trims, collapses inner whitespace, drops blanks and de-duplicates case-insensitively (first spelling wins)", () => {
    expect(normalizeTags(["  NLP ", "nlp", "Deep   Learning", "deep learning", "", "   ", "Vision"]))
      .toEqual(["NLP", "Deep Learning", "Vision"]);
  });

  it("keeps the order and handles an empty list", () => {
    expect(normalizeTags(["b", "a", "c"])).toEqual(["b", "a", "c"]);
    expect(normalizeTags([])).toEqual([]);
  });
});
