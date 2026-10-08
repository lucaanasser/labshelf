import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEntities, parseHtmlPage, redirectTargets } from "../../src/capture/htmlPage";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

describe("parseHtmlPage", () => {
  const raw = parseHtmlPage(fixture("springerArticle.html"), "https://link.springer.com/article/10.1007/s10107-023-01234-5");

  it("collects every meta value under its lower-cased name, decoding entities", () => {
    expect(raw.meta["citation_author"]).toEqual(["Edelman, Alan", "Arias, Tomás A.", "Smith, Steven T."]);
    expect(raw.meta["citation_doi"]).toEqual(["10.1007/s10107-023-01234-5"]);
    expect(raw.meta["og:title"]).toEqual(["Optimization algorithms (og)"]);
  });

  it("finds PDF anchors (absolute) and doi.org links", () => {
    expect(raw.pdfLinks.map((l) => l.url)).toContain("https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf");
    expect(raw.doiLinks).toEqual(["https://doi.org/10.1137/S0895479895290954", "https://doi.org/10.1007/BF01582228"]);
    expect(raw.documentTitle).toBe("Optimization algorithms on the Grassmann manifold | Mathematical Programming");
  });
});

describe("redirectTargets", () => {
  it("reads meta refresh and scripted location changes, de-duplicated", () => {
    const targets = redirectTargets(fixture("sciencedirectInterstitial.html"), "https://www.sciencedirect.com/science/article/pii/0196677482900074/pdfft");
    expect(targets).toEqual([
      "https://pdf.sciencedirectassets.com/272/1-s2.0-0196677482900074/main.pdf?X-Amz-Token=abc&X-Amz-Date=20261007",
    ]);
  });

  it("returns nothing for a page that does not redirect", () => {
    expect(redirectTargets(fixture("loginWall.html"), "https://example.org/login")).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones", () => {
    expect(decodeEntities("Tom&#225;s &amp; Jos&#xe9; &unknown;")).toBe("Tomás & José &unknown;");
  });
});
