import type { PaperRecord } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

// A minimal in-memory stand-in for the IndexedDB file system, so attachPdfToPaper
// runs its real write + artifact-rewrite path without a database.
const mockFiles = new Map<string, Uint8Array>();
jest.mock("../../src/storage/indexedDbFileSystem", () => ({
  IndexedDbFileSystem: class {
    async writeFile(path: string, bytes: Uint8Array): Promise<void> { mockFiles.set(path, bytes); }
    async readFile(path: string): Promise<Uint8Array> {
      const b = mockFiles.get(path);
      if (!b) throw new Error(`not found: ${path}`);
      return b;
    }
    async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; mtimeMs: number; size: number } | undefined> {
      const file = mockFiles.get(path);
      if (file) return { isFile: true, isDirectory: false, mtimeMs: 0, size: file.length };
      for (const k of mockFiles.keys()) if (k.startsWith(`${path}/`)) return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
      return undefined;
    }
  },
}));

let mockRecords: PaperRecord[] = [];
jest.mock("../../src/storage/paperRecordStore", () => ({
  listAllRecords: async () => mockRecords,
  upsertRecord: async () => undefined,
}));

import { addPaper, attachPdfToPaper } from "../../src/capture/addPaperFlow";
import { safeFolder } from "../../src/capture/captureService";

describe("addPaper", () => {
  const meta = { authors: ["Ann Lee"], year: 2020, title: "Attention" };
  beforeEach(() => { mockFiles.clear(); mockRecords = []; });

  it("normalises the tags it stores", async () => {
    const paper = await addPaper(undefined, meta, "x", "papers", { tags: ["NLP", "nlp", " Deep   Learning "] });
    expect(paper.tags).toEqual(["NLP", "Deep Learning"]);
  });

  it("skips an id taken in another casing", async () => {
    mockRecords = [{ id: "Lee2020Attention", title: "Other", citeKey: "Lee2020Attention", path: "papers/Lee2020Attention", status: "unread" }];
    const paper = await addPaper(undefined, meta, "x");
    expect(paper.id).toBe("lee2020attentiona");
    expect(paper.path).toBe("papers/lee2020attentiona");
  });

  it("skips a folder that exists without a cached record", async () => {
    mockFiles.set("papers/lee2020attention/metadata.yaml", new Uint8Array());
    const paper = await addPaper(undefined, meta, "x");
    expect(paper.id).toBe("lee2020attentiona");
  });
});

describe("safeFolder", () => {
  it("accepts collections under papers/ and falls back to the root otherwise", () => {
    expect(safeFolder("papers/Thesis/Ch2/")).toBe("papers/Thesis/Ch2");
    expect(safeFolder(undefined)).toBe("papers");
    expect(safeFolder("appdata/secrets")).toBe("papers");
    expect(safeFolder("papers/../appdata")).toBe("papers");
  });
});

describe("attachPdfToPaper", () => {
  const PDF = new TextEncoder().encode("%PDF-1.7\n...");
  const record = (over: Partial<PaperRecord> = {}): PaperRecord =>
    ({ id: "smith2020deep", title: "Deep", citeKey: "smith2020deep", path: "papers/smith2020deep", status: "unread", ...over });

  beforeEach(() => { mockFiles.clear(); mockRecords = []; });

  it("writes paper.pdf and rewrites the artifacts when the paper had none", async () => {
    mockRecords = [record()];
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(result.record.id).toBe("smith2020deep");
    expect(mockFiles.get("papers/smith2020deep/paper.pdf")).toBe(PDF);
    expect(mockFiles.has("papers/smith2020deep/metadata.yaml")).toBe(true);
    expect(mockFiles.has("papers/smith2020deep/bib.bib")).toBe(true);
  });

  it("refuses to overwrite a PDF that is already there and rewrites nothing", async () => {
    mockRecords = [record()];
    const existing = new Uint8Array([1, 2, 3]);
    mockFiles.set("papers/smith2020deep/paper.pdf", existing);
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(false);
    expect(mockFiles.get("papers/smith2020deep/paper.pdf")).toBe(existing);
    expect(mockFiles.has("papers/smith2020deep/metadata.yaml")).toBe(false);
  });

  it("writes at the record's current path even when it moved since the id was captured", async () => {
    mockRecords = [record({ path: "papers/Thesis/smith2020deep" })];
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(mockFiles.has("papers/Thesis/smith2020deep/paper.pdf")).toBe(true);
    expect(mockFiles.has("papers/smith2020deep/paper.pdf")).toBe(false);
  });

  it("throws when the record is gone", async () => {
    mockRecords = [];
    await expect(attachPdfToPaper("ghost", PDF)).rejects.toThrow(/no longer in the library/);
  });
});
