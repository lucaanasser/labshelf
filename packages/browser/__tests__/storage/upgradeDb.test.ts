import { DB_VERSION, upgradeDb } from "../../src/storage/idb/upgrade";

function fakeStore(indexes: string[]) {
  const names = new Set(indexes);
  return {
    indexNames: { contains: (n: string) => names.has(n) },
    deleteIndex: jest.fn((n: string) => { names.delete(n); }),
  };
}

describe("upgradeDb", () => {
  it("creates the three stores without indexes in a new database", () => {
    const db = { createObjectStore: jest.fn() };
    upgradeDb(db as never, 0, {} as never);
    expect(db.createObjectStore.mock.calls.map((c) => c[0])).toEqual(["files", "metadata", "manifest"]);
  });

  it("drops the version 1 indexes and leaves the stores in place", () => {
    const files = fakeStore(["byHash"]);
    const metadata = fakeStore(["byFolder"]);
    const db = { createObjectStore: jest.fn() };
    const tx = { objectStore: (n: string) => (n === "files" ? files : metadata) };
    upgradeDb(db as never, 1, tx as never);
    expect(files.deleteIndex).toHaveBeenCalledWith("byHash");
    expect(metadata.deleteIndex).toHaveBeenCalledWith("byFolder");
    expect(db.createObjectStore).not.toHaveBeenCalled();
    expect(DB_VERSION).toBe(2);
  });
});
