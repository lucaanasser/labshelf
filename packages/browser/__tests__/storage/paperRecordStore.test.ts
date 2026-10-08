import { rebuildFromFiles } from "../../src/storage/paperRecordStore";

const files = new Map<string, string>();
const written: Array<{ paperId: string; record: Record<string, unknown>; folderPath: string }> = [];

jest.mock("../../src/storage/idb/db", () => ({
  getDb: async () => ({
    getAllKeys: async () => [...files.keys()],
    get: async (_store: string, key: string) => (files.has(key) ? { bytes: new TextEncoder().encode(files.get(key)) } : undefined),
    transaction: () => ({
      store: { clear: async () => { written.length = 0; }, put: async (row: (typeof written)[number]) => { written.push(row); } },
      done: Promise.resolve(),
    }),
  }),
}));

// rebuildFromFiles bounds its key scan with the browser's IDBKeyRange; the fake store ignores the range.
(globalThis as Record<string, unknown>)["IDBKeyRange"] = { bound: () => undefined };

beforeEach(() => {
  files.clear();
  written.length = 0;
});

describe("rebuildFromFiles", () => {
  it("builds one record per metadata.yaml, with the id and path taken from the folder", async () => {
    files.set("papers/Algo/imai1986/metadata.yaml", "title: Efficient Algorithms\npath: /Users/me/elsewhere\ntextLayer: { state: native, checkedAt: \"2026-01-01\" }\n");
    files.set("papers/Algo/imai1986/paper.pdf", "PDF");

    await rebuildFromFiles();

    expect(written).toEqual([{
      paperId: "imai1986",
      folderPath: "papers/Algo/imai1986",
      record: {
        id: "imai1986", title: "Efficient Algorithms", path: "papers/Algo/imai1986", citeKey: "imai1986",
        status: "unread", hasPdf: true, textLayer: { state: "native", checkedAt: "2026-01-01" },
      },
    }]);
  });

  it("sets hasPdf only for folders holding an exact paper.pdf", async () => {
    files.set("papers/a/metadata.yaml", "title: A\n");
    files.set("papers/a/paper.pdf", "PDF");
    files.set("papers/b/metadata.yaml", "title: B\n");
    files.set("papers/b/paper (conflict 2026-05-22).pdf", "PDF");

    await rebuildFromFiles();

    expect(Object.fromEntries(written.map((row) => [row.paperId, row.record["hasPdf"]]))).toEqual({ a: true, b: false });
  });

  it("skips text that is not a YAML mapping and a metadata.yaml with no folder name", async () => {
    files.set("papers/list/metadata.yaml", "- a\n- b\n");
    files.set("papers/broken/metadata.yaml", "title: [unclosed");
    files.set("/metadata.yaml", "title: Rootless\n");
    files.set("papers/ok/metadata.yaml", "title: Fine\n");

    await rebuildFromFiles();

    expect(written.map((row) => row.paperId)).toEqual(["ok"]);
  });

  it("drops a number in a string field instead of turning it into text", async () => {
    files.set("papers/p/metadata.yaml", "title: P\nvolume: 15\nissue: \"3\"\n");

    await rebuildFromFiles();

    expect(written[0]!.record).not.toHaveProperty("volume");
    expect(written[0]!.record["issue"]).toBe("3");
  });
});
