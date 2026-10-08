import { isScholarUrl, lookupItemFor, parseAuthorsLine } from "../../src/content/scholarParse";
import { idsFromHit, metadataFromHit } from "../../src/capture/scholarCapture";
import type { ScholarHit } from "../../src/platform/runtimeMessages";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

describe("isScholarUrl", () => {
  it("accepts Google Scholar and its country domains only", () => {
    expect(isScholarUrl("https://scholar.google.com/scholar?q=x")).toBe(true);
    expect(isScholarUrl("https://scholar.google.com.br/scholar?hl=pt-BR&q=x")).toBe(true);
    expect(isScholarUrl("https://scholar.google.co.uk/scholar?q=x")).toBe(true);
    expect(isScholarUrl("https://scholar.google.de/scholar?q=x")).toBe(true);
    expect(isScholarUrl("https://scholar.google.evil.com/scholar?q=x")).toBe(false);
    expect(isScholarUrl("http://scholar.google.com/scholar?q=x")).toBe(false);
    expect(isScholarUrl(undefined)).toBe(false);
  });
});

describe("parseAuthorsLine", () => {
  it("splits authors, venue, year and host (truncated authors and venue)", () => {
    expect(parseAuthorsLine("A Aggarwal, M Klawe, S Moran, P Shor… - Proceedings of the …, 1986 - dl.acm.org")).toEqual({
      authors: ["A Aggarwal", "M Klawe", "S Moran", "P Shor"], venue: "Proceedings of the …", year: 1986, host: "dl.acm.org",
    });
  });

  it("reads a journal line with a publisher host", () => {
    expect(parseAuthorsLine("OH Ibarra, S Moran, R Hui\u00a0- Journal of algorithms, 1982\u00a0- Elsevier")).toEqual({
      authors: ["OH Ibarra", "S Moran", "R Hui"], venue: "Journal of algorithms", year: 1982, host: "Elsevier",
    });
  });

  it("keeps a venue containing a hyphenated word and a year-only middle", () => {
    expect(parseAuthorsLine("PI Davies, NJ Higham - SIAM Journal on Matrix Analysis and Applications, 2003 - SIAM").year).toBe(2003);
    expect(parseAuthorsLine("J Doe - 2001 - example.org")).toEqual({ authors: ["J Doe"], year: 2001, host: "example.org" });
  });
});

const withoutPdf = (h: ScholarHit): ScholarHit => { const { pdfUrl: _pdf, ...rest } = h; return rest; };
const hit = (over: Partial<ScholarHit> = {}): ScholarHit => ({
  key: "cid1", title: "Geometric applications of a matrix searching algorithm", authors: ["A Aggarwal", "P Shor"],
  url: "https://dl.acm.org/doi/abs/10.1145/10515.10546", pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/10515.10546",
  venue: "Proceedings of the …", year: 1986, ...over,
});

describe("Scholar hit → capture", () => {
  it("takes the DOI from the result's links", () => {
    expect(idsFromHit(hit())).toEqual({ doi: "10.1145/10515.10546" });
    expect(idsFromHit(withoutPdf(hit({ url: "https://www.sciencedirect.com/science/article/pii/0196677482900074" })))).toEqual({});
    expect(idsFromHit(withoutPdf(hit({ url: "https://arxiv.org/abs/1706.03762" })))).toEqual({ arxivId: "1706.03762" });
  });

  it("keeps a truncated venue out of the record", () => {
    expect(metadataFromHit(hit())).toEqual({
      title: "Geometric applications of a matrix searching algorithm", authors: ["A Aggarwal", "P Shor"], year: 1986,
      url: "https://dl.acm.org/doi/abs/10.1145/10515.10546",
    });
    expect(metadataFromHit(hit({ venue: "Journal of algorithms" })).journal).toBe("Journal of algorithms");
  });

  it("builds the library lookup item", () => {
    expect(lookupItemFor(hit())).toEqual({ key: "cid1", title: hit().title, year: 1986, doi: "10.1145/10515.10546" });
  });
});
