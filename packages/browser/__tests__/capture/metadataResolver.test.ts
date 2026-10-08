import type { ResolvedMetadata } from "@labshelf/core";

const resolveOnlineMetadata = jest.fn();
const searchOnlineByTitle = jest.fn();
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  resolveOnlineMetadata: (...args: unknown[]) => resolveOnlineMetadata(...args),
  searchOnlineByTitle: (...args: unknown[]) => searchOnlineByTitle(...args),
}));

import { agrees, PAGE_TRUST, resolveMetadata, surname } from "../../src/capture/metadataResolver";

const page = (metadata: ResolvedMetadata, trust: number = PAGE_TRUST.structured) => ({ name: "page", trust, metadata });

beforeEach(() => {
  resolveOnlineMetadata.mockReset();
  searchOnlineByTitle.mockReset();
});

describe("resolveMetadata", () => {
  it("lets the registry win each field it has and keeps what only the page states", async () => {
    resolveOnlineMetadata.mockResolvedValue({ title: "Registry Title", authors: ["Oscar H. Ibarra"], year: 1982, journal: "Journal of Algorithms", volume: "3" });
    const r = await resolveMetadata({
      ids: { doi: "10.1016/0196-6774(82)90007-4" },
      sources: [page({ title: "Page title", journal: "J. Algorithms", issue: "1", pages: "45-56" })],
    });
    expect(r.origin).toBe("registry");
    expect(r.metadata).toMatchObject({ title: "Registry Title", journal: "Journal of Algorithms", volume: "3", issue: "1", pages: "45-56" });
    expect(resolveOnlineMetadata).toHaveBeenCalledWith({ type: "doi", value: "10.1016/0196-6774(82)90007-4" });
  });

  it("finds the DOI by title when the page has none, if year and authors agree", async () => {
    searchOnlineByTitle.mockResolvedValue({ title: "A generalization of the fast LUP", authors: ["O. H. Ibarra", "S. Moran"], year: 1982, doi: "10.1016/x" });
    const r = await resolveMetadata({ ids: {}, sources: [page({ title: "A generalization of the fast LUP", authors: ["OH Ibarra"], year: 1982 }, 20)] });
    expect(r.origin).toBe("search");
    expect(r.ids.doi).toBe("10.1016/x");
  });

  it("rejects a title match from another year", async () => {
    searchOnlineByTitle.mockResolvedValue({ title: "Same title", year: 2010, doi: "10.1/wrong" });
    const r = await resolveMetadata({ ids: {}, sources: [page({ title: "Same title", year: 1982 })] });
    expect(r.origin).toBe("page");
    expect(r.ids.doi).toBeUndefined();
  });

  it("asks arXiv, not the registry, for an arXiv DOI", async () => {
    resolveOnlineMetadata.mockResolvedValue({ title: "Attention Is All You Need" });
    await resolveMetadata({ ids: { doi: "10.48550/arXiv.1706.03762", arxivId: "1706.03762" }, sources: [] });
    expect(resolveOnlineMetadata).toHaveBeenCalledWith({ type: "arxiv", value: "1706.03762" });
  });
});

describe("agrees / surname", () => {
  it("compares surnames, ignoring initials, accents and truncation marks", () => {
    expect(surname("P Shor…")).toBe("shor");
    expect(surname("José Müller")).toBe("muller");
    expect(agrees({ authors: ["Peter W. Shor"], year: 1986 }, { authors: ["P Shor…"], year: 1987 })).toBe(true);
    expect(agrees({ authors: ["Someone Else"] }, { authors: ["P Shor"] })).toBe(false);
  });
});
