import { auditBibliography } from "../../src/analysis/bibAudit";

describe("auditBibliography", () => {
  it("detects unused and missing entries", () => {
    const tex = ["see \\cite{kaplan2020} and \\citep{hoffmann2022}."];
    const bib = `
      @article{kaplan2020, title={...}}
      @article{brown2020, title={...}}
    `;
    const result = auditBibliography(tex, bib);
    expect(result.citedKeys).toEqual(["hoffmann2022", "kaplan2020"]);
    expect(result.unusedKeys).toEqual(["brown2020"]);
    expect(result.missingKeys).toEqual(["hoffmann2022"]);
  });

  it("handles multiple keys in a single cite", () => {
    const tex = ["\\cite{a, b, c}"];
    const bib = "@article{a,} @article{b,} @article{c,}";
    const result = auditBibliography(tex, bib);
    expect(result.unusedKeys).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });
});
