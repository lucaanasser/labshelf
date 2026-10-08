import { titleKey } from "@labshelf/core";

describe("titleKey", () => {
  it("normalises accents, case and punctuation", () => {
    expect(titleKey("  Análise: A Ótima  ")).toBe("analise a otima");
  });

  it("treats titles that differ only in punctuation as equal", () => {
    expect(titleKey("Deep-Learning (2nd ed.)")).toBe(titleKey("deep learning 2nd ed"));
  });
});
