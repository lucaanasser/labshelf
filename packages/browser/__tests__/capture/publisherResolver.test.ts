import { landingPdfUrls, publisherPdfUrls, publisherResolver } from "../../src/capture/resolvers/publisherResolver";

const ctx = { pageCandidates: [], allowSciHub: false, contactEmail: "x@y.z", sciHubMirror: "" };

describe("publisherPdfUrls", () => {
  it("builds the platform PDF URL from the DOI prefix", () => {
    expect(publisherPdfUrls("10.1137/S0895479802410815")).toEqual(["https://epubs.siam.org/doi/pdf/10.1137/S0895479802410815"]);
    expect(publisherPdfUrls("10.1145/10515.10546")).toEqual(["https://dl.acm.org/doi/pdf/10.1145/10515.10546"]);
    expect(publisherPdfUrls("10.1007/s10107-023-01234-5")).toEqual(["https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf"]);
    expect(publisherPdfUrls("10.1002/anie.201915678")).toEqual(["https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/anie.201915678"]);
  });

  it("knows nothing about platforms whose PDF URL is not a function of the DOI", () => {
    // Elsevier needs the PII, not the DOI.
    expect(publisherPdfUrls("10.1016/0196-6774(82)90007-4")).toEqual([]);
  });

  it("returns nothing without a DOI", async () => {
    await expect(publisherResolver.resolve(ctx)).resolves.toEqual([]);
    await expect(publisherResolver.resolve({ ...ctx, doi: "10.1145/1.2" })).resolves.toEqual(["https://dl.acm.org/doi/pdf/10.1145/1.2"]);
  });
});

describe("landingPdfUrls", () => {
  it("builds ScienceDirect's PDF link from the PII and IEEE's from the article number", () => {
    expect(landingPdfUrls("https://www.sciencedirect.com/science/article/abs/pii/0196677482900074")).toEqual([
      "https://www.sciencedirect.com/science/article/pii/0196677482900074/pdfft?isDTMRedir=true&download=true",
    ]);
    expect(landingPdfUrls("https://ieeexplore.ieee.org/abstract/document/1234567")).toEqual([
      "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=1234567",
    ]);
    expect(landingPdfUrls("https://example.org/paper")).toEqual([]);
  });

  it("puts the landing-page link before DOI templates", async () => {
    const urls = await publisherResolver.resolve({ ...ctx, doi: "10.1145/1.2", landingUrl: "https://ieeexplore.ieee.org/document/42" });
    expect(urls).toEqual(["https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=42", "https://dl.acm.org/doi/pdf/10.1145/1.2"]);
  });
});
