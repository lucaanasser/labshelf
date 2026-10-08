import type { PaperRecord } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

// The real IndexedDbFileSystem runs over a Map-backed store, so attachPdfToPaper exercises its real write path.
jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

let mockRecords: PaperRecord[] = [];
jest.mock("../../src/storage/paperRecordStore", () => ({
  listAllRecords: async () => mockRecords,
  upsertRecord: async () => undefined,
}));

import { addPaper, attachPdfToPaper } from "../../src/capture/addPaperFlow";
import { safeFolder } from "../../src/capture/captureService";
import { fakeFiles, putFile, textAt } from "../support/fakeIdb";

describe("addPaper", () => {
  const meta = { authors: ["Ann Lee"], year: 2020, title: "Attention" };
  beforeEach(() => { fakeFiles.clear(); mockRecords = []; });

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
    putFile("papers/lee2020attention/metadata.yaml", "");
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

  beforeEach(() => { fakeFiles.clear(); mockRecords = []; });

  it("writes paper.pdf and rewrites the artifacts when the paper had none", async () => {
    mockRecords = [record()];
    putFile("papers/smith2020deep/metadata.yaml", "title: Deep\nstatus: unread\n");
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(result.record.id).toBe("smith2020deep");
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(PDF);
    expect(fakeFiles.has("papers/smith2020deep/metadata.yaml")).toBe(true);
    expect(fakeFiles.has("papers/smith2020deep/bib.bib")).toBe(true);
  });

  it("refuses to overwrite a PDF that is already there and rewrites nothing", async () => {
    mockRecords = [record()];
    const existing = new Uint8Array([1, 2, 3]);
    putFile("papers/smith2020deep/paper.pdf", existing);
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(false);
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(existing);
    expect(fakeFiles.has("papers/smith2020deep/metadata.yaml")).toBe(false);
  });

  it("writes at the record's current path even when it moved since the id was captured", async () => {
    mockRecords = [record({ path: "papers/Thesis/smith2020deep" })];
    putFile("papers/Thesis/smith2020deep/metadata.yaml", "title: Deep\nstatus: unread\n");
    const result = await attachPdfToPaper("smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(fakeFiles.has("papers/Thesis/smith2020deep/paper.pdf")).toBe(true);
    expect(fakeFiles.has("papers/smith2020deep/paper.pdf")).toBe(false);
  });

  it("keeps the status on disk when the cached status is stale", async () => {
    mockRecords = [record({ status: "unread" })];
    putFile("papers/smith2020deep/metadata.yaml", "title: Deep\nstatus: done\ncitekey: smith2020deep\n");
    await attachPdfToPaper("smith2020deep", PDF);
    expect(textAt("papers/smith2020deep/metadata.yaml")).toMatch(/status: done/);
  });

  it("throws when the record is gone", async () => {
    mockRecords = [];
    await expect(attachPdfToPaper("ghost", PDF)).rejects.toThrow(/no longer in the library/);
  });
});
