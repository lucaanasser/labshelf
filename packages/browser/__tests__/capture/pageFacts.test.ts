import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtmlPage } from "../../src/capture/htmlPage";
import { authorsOf, interpretPage, pagesOf, yearOf } from "../../src/capture/pageFacts";
import type { RawPage } from "../../src/capture/pageProbeContentScript";

const springer = (): RawPage => parseHtmlPage(
  readFileSync(join(__dirname, "..", "fixtures", "springerArticle.html"), "utf8"),
  "https://link.springer.com/article/10.1007/s10107-023-01234-5",
);
const page = (over: Partial<RawPage>): RawPage => ({ pageUrl: "https://example.org/a", meta: {}, pdfLinks: [], doiLinks: [], ...over });

describe("interpretPage", () => {
  it("reads the full citation record a publisher page states", () => {
    const facts = interpretPage(springer());
    expect(facts.isPaper).toBe(true);
    expect(facts.structured).toBe(true);
    expect(facts.ids).toEqual({ doi: "10.1007/s10107-023-01234-5" });
    expect(facts.metadata).toMatchObject({
      title: "Optimization algorithms on the Grassmann manifold with applications",
      authors: ["Alan Edelman", "Tomás A. Arias", "Steven T. Smith"],
      year: 2024,
      journal: "Mathematical Programming",
      publisher: "Springer Berlin Heidelberg",
      volume: "203",
      issue: "1",
      pages: "45-56",
      issn: "0025-5610",
      language: "en",
      doi: "10.1007/s10107-023-01234-5",
      summary: "We develop Newton and conjugate gradient algorithms on the Grassmann manifold.",
      keywords: ["Grassmann manifold", "Riemannian optimization"],
    });
  });

  it("orders PDF candidates: citation_pdf_url first, then own anchors, never supplementary files", () => {
    const urls = interpretPage(springer()).pdfCandidates.map((c) => c.url);
    expect(urls[0]).toBe("https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf");
    expect(urls.some((u) => u.includes("supplementary"))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("does not take a DOI from a reference list with several doi.org links", () => {
    const facts = interpretPage(page({ doiLinks: ["https://doi.org/10.1/a", "https://doi.org/10.1/b"] }));
    expect(facts.ids.doi).toBeUndefined();
  });

  it("takes the DOI of a lone doi.org link and of a /doi/ URL", () => {
    expect(interpretPage(page({ doiLinks: ["https://doi.org/10.1145/10515.10546"] })).ids.doi).toBe("10.1145/10515.10546");
    expect(interpretPage(page({ pageUrl: "https://onlinelibrary.wiley.com/doi/full/10.1002/anie.201915678" })).ids.doi).toBe("10.1002/anie.201915678");
  });

  it("skips a dc.identifier that is not a DOI and keeps looking", () => {
    const facts = interpretPage(page({ meta: { "dc.identifier": ["ISBN 978-3-16-148410-0", "doi:10.1016/0196-6774(82)90007-4"] } }));
    expect(facts.ids.doi).toBe("10.1016/0196-6774(82)90007-4");
  });

  it("recognises arXiv pages and the arXiv DOI", () => {
    expect(interpretPage(page({ pageUrl: "https://arxiv.org/abs/2301.12345v2" })).ids.arxivId).toBe("2301.12345");
    expect(interpretPage(page({ meta: { citation_doi: ["10.48550/arXiv.1706.03762"] } })).ids).toMatchObject({ arxivId: "1706.03762" });
  });

  it("treats a PDF tab as a paper whose first candidate is the tab itself", () => {
    const facts = interpretPage(page({ pageUrl: "https://example.org/x.pdf", pageIsPdf: true }));
    expect(facts.isPaper).toBe(true);
    expect(facts.pdfCandidates[0]).toEqual({ url: "https://example.org/x.pdf", source: "page" });
    expect(facts.metadata.url).toBeUndefined();
  });

  it("does not call an ordinary web page a paper", () => {
    const facts = interpretPage(page({ documentTitle: "My blog", meta: { "og:title": ["My blog"], description: ["posts"] } }));
    expect(facts.isPaper).toBe(false);
    expect(facts.metadata.title).toBe("My blog");
  });
});

describe("field helpers", () => {
  it("flips 'Family, Given' and de-duplicates authors", () => {
    expect(authorsOf(["Ibarra, Oscar H.", "Ibarra, Oscar H.", "Shlomo Moran"], [])).toEqual(["Oscar H. Ibarra", "Shlomo Moran"]);
    expect(authorsOf([], [], "Moran, S; Hui, R")).toEqual(["S Moran", "R Hui"]);
  });

  it("extracts years and joins page ranges", () => {
    expect(yearOf("1982/03/01")).toBe(1982);
    expect(yearOf("March 2003")).toBe(2003);
    expect(yearOf("n.d.")).toBeUndefined();
    expect(pagesOf("45", "56")).toBe("45-56");
    expect(pagesOf("7", "7")).toBe("7");
    expect(pagesOf(undefined, "9")).toBeUndefined();
  });
});
