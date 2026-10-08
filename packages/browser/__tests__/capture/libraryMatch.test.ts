import type { PaperRecord } from "@labshelf/core";
import { findInLibrary } from "../../src/capture/libraryMatch";

const rec = (over: Partial<PaperRecord>): PaperRecord => ({
  id: "x", title: "T", path: "papers/x", citeKey: "x", status: "unread", ...over,
});
const library = [
  rec({ id: "ibarra1982generalization", path: "papers/Algo/ibarra1982generalization", title: "A generalization of the fast LUP matrix decomposition algorithm and applications", year: 1982, doi: "10.1016/0196-6774(82)90007-4" }),
  rec({ id: "vaswani2017attention", title: "Attention Is All You Need", year: 2017, url: "https://arxiv.org/abs/1706.03762" }),
  rec({ id: "intro", title: "Introduction" }),
];

describe("findInLibrary", () => {
  it("matches by DOI, case-insensitively", () => {
    expect(findInLibrary(library, { doi: "10.1016/0196-6774(82)90007-4".toUpperCase() })?.id).toBe("ibarra1982generalization");
  });

  it("matches arXiv preprints by id", () => {
    expect(findInLibrary(library, { arxivId: "1706.03762v5" })?.id).toBe("vaswani2017attention");
  });

  it("matches a normalised title when the years agree", () => {
    const title = "A Generalization of the Fast LUP Matrix Decomposition Algorithm and Applications.";
    expect(findInLibrary(library, { title, year: 1982 })?.id).toBe("ibarra1982generalization");
    expect(findInLibrary(library, { title, year: 1999 })).toBeUndefined();
  });

  it("never matches on a title too short to identify a paper", () => {
    expect(findInLibrary(library, { title: "Introduction" })).toBeUndefined();
  });
});
