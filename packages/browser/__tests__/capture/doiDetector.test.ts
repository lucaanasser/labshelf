import { arxivIdFromDoi, arxivIdFromUrl, cleanDoi, pmidFromUrl } from "../../src/capture/doiDetector";

describe("cleanDoi", () => {
  it.each([
    ["https://doi.org/10.1016/0196-6774(82)90007-4", "10.1016/0196-6774(82)90007-4"],
    ["(doi:10.1145/10515.10546).", "10.1145/10515.10546"],
    ["https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf", "10.1007/s10107-023-01234-5"],
    ["https://onlinelibrary.wiley.com/doi/10.1002/anie.201915678/abstract", "10.1002/anie.201915678"],
    ["https://epubs.siam.org/doi/pdf/10.1137/S0895479802410815?download=true", "10.1137/S0895479802410815"],
    ["https://www.example.org/doi/10.1000%2Fxyz123", "10.1000/xyz123"],
  ])("%s → %s", (input, doi) => {
    expect(cleanDoi(input)).toBe(doi);
  });

  it("returns undefined when there is no DOI", () => {
    expect(cleanDoi("https://www.sciencedirect.com/science/article/pii/0196677482900074")).toBeUndefined();
    expect(cleanDoi(undefined)).toBeUndefined();
  });
});

describe("other identifiers", () => {
  it("reads arXiv ids from URLs and arXiv DOIs", () => {
    expect(arxivIdFromUrl("https://arxiv.org/pdf/1706.03762v7")).toBe("1706.03762");
    expect(arxivIdFromDoi("10.48550/arXiv.1706.03762")).toBe("1706.03762");
    expect(arxivIdFromDoi("10.1145/1")).toBeUndefined();
  });

  it("reads PMIDs from both PubMed URL forms", () => {
    expect(pmidFromUrl("https://pubmed.ncbi.nlm.nih.gov/12345678/")).toBe("12345678");
    expect(pmidFromUrl("https://www.ncbi.nlm.nih.gov/pubmed/7654321")).toBe("7654321");
  });
});
