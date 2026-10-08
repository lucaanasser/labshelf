import { IndexedDbFileSystem } from "../../src/storage/indexedDbFileSystem";
import { fakeFiles, putFile, textAt } from "../support/fakeIdb";

jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

const fs = new IndexedDbFileSystem();

beforeEach(() => fakeFiles.clear());

describe("rename", () => {
  it("re-keys every row under a folder and keeps the bytes", async () => {
    putFile("papers/a/x/metadata.yaml", "title: X");
    putFile("papers/a/x/paper.pdf", "PDF");
    putFile("papers/ab/other.txt", "stays");

    await fs.rename("papers/a", "papers/b");

    expect([...fakeFiles.keys()].sort()).toEqual(["papers/ab/other.txt", "papers/b/x/metadata.yaml", "papers/b/x/paper.pdf"]);
    expect(textAt("papers/b/x/paper.pdf")).toBe("PDF");
  });

  it("renames a single file", async () => {
    putFile("papers/a.txt", "hello");
    await fs.rename("papers/a.txt", "papers/b.txt");
    expect([...fakeFiles.keys()]).toEqual(["papers/b.txt"]);
  });

  it("refuses a destination that exists and changes nothing", async () => {
    putFile("papers/a/f", "1");
    putFile("papers/b/g", "2");
    await expect(fs.rename("papers/a", "papers/b")).rejects.toThrow(/Already exists/);
    expect([...fakeFiles.keys()].sort()).toEqual(["papers/a/f", "papers/b/g"]);
  });

  it("renames a folder to the same name in another letter case", async () => {
    putFile("papers/ml/f", "1");
    await fs.rename("papers/ml", "papers/ML");
    expect([...fakeFiles.keys()]).toEqual(["papers/ML/f"]);
  });

  it("fails for a source that does not exist", async () => {
    await expect(fs.rename("papers/missing", "papers/b")).rejects.toThrow(/not found/);
  });
});

describe("trash", () => {
  it("deletes a folder with everything in it and leaves the neighbours", async () => {
    putFile("papers/a/f", "1");
    putFile("papers/a/deep/g", "2");
    putFile("papers/ab/h", "3");
    await fs.trash("papers/a");
    expect([...fakeFiles.keys()]).toEqual(["papers/ab/h"]);
  });
});

describe("mkdir", () => {
  it("makes an empty folder exist through a zero-byte .keep", async () => {
    await fs.mkdir("papers/New");
    expect(fakeFiles.get("papers/New/.keep")?.bytes.length).toBe(0);
    expect(await fs.stat("papers/New")).toMatchObject({ isDirectory: true });
  });
});

describe("text access", () => {
  it("round-trips text and reports existence of files and folders", async () => {
    await fs.writeText("papers/a/metadata.yaml", "title: Ü");
    expect(await fs.readText("papers/a/metadata.yaml")).toBe("title: Ü");
    expect(await fs.exists("papers/a")).toBe(true);
    expect(await fs.exists("papers/b")).toBe(false);
  });
});
