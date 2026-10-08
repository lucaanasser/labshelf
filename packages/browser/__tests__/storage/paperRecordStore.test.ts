import { recordFromYaml } from "../../src/storage/paperRecordStore";

describe("recordFromYaml", () => {
  it("maps a sidecar the way the VS Code indexer does (id = folder name, path = library path)", () => {
    const yaml = [
      "title: Efficient Algorithms",
      "authors: [Hiroshi Imai, Takao Asano]",
      "year: 1986",
      "path: /Users/me/LabShelfLibrary/papers/Algo/imai1986",
      "citekey: imai1986",
      "status: reading",
      "journal: SIAM J. Comput.",
      "volume: 15",
      "doi: 10.1137/0215034",
      "keywords: [graphs]",
      "tags: [geometry, to-read]",
      "note: Cited in chapter 3",
      "source: imai.pdf",
    ].join("\n");
    expect(recordFromYaml(yaml, "papers/Algo/imai1986")).toEqual({
      id: "imai1986", title: "Efficient Algorithms", path: "papers/Algo/imai1986", citeKey: "imai1986", status: "reading",
      authors: ["Hiroshi Imai", "Takao Asano"], year: 1986, journal: "SIAM J. Comput.", volume: "15", doi: "10.1137/0215034",
      keywords: ["graphs"], tags: ["geometry", "to-read"], note: "Cited in chapter 3",
    });
  });

  it("falls back to the folder name and unread for a sparse or odd sidecar", () => {
    expect(recordFromYaml("status: archived\n", "papers/x1")).toEqual({ id: "x1", title: "x1", path: "papers/x1", citeKey: "x1", status: "unread" });
  });

  it("rejects text that is not a YAML mapping", () => {
    expect(recordFromYaml("title: [unclosed", "papers/x")).toBeUndefined();
    expect(recordFromYaml("- a\n- b\n", "papers/x")).toBeUndefined();
  });
});
