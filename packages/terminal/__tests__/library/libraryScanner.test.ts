import { promises as fs } from "node:fs";
import * as path from "node:path";

import { papersUnder, readPaperFolder, scanLibrary } from "../../src/library/libraryScanner";
import { cleanupTempDirs, createTempLibrary, fakePdfBytes, setMtime } from "../fixtures/library";

afterEach(cleanupTempDirs);

describe("scanLibrary: collections", () => {
  it("returns only the root collection for an empty library", async () => {
    const lib = await createTempLibrary();
    const snap = await scanLibrary(lib.paths);
    expect([...snap.collections.keys()]).toEqual([""]);
    expect(snap.collections.get("")).toMatchObject({ rel: "", name: "papers", parent: undefined, children: [], paperIds: [], total: 0 });
    expect(snap.papers.size).toBe(0);
    expect(snap.root).toBe(lib.root);
  });

  it("turns nested folders into collections with parent, children and total counts", async () => {
    const lib = await createTempLibrary([
      { id: "d", title: "Root paper" },
      { id: "a", collection: "ML" },
      { id: "b", collection: "ML" },
      { id: "c", collection: "ML/Vision" },
      { id: "e", collection: "Bio" },
    ]);
    await lib.addCollection("Empty");
    const snap = await scanLibrary(lib.paths);

    expect([...snap.collections.keys()].sort()).toEqual(["", "Bio", "Empty", "ML", "ML/Vision"]);

    const root = snap.collections.get("")!;
    expect(root.children).toEqual(["Bio", "Empty", "ML"]);
    expect(root.paperIds).toEqual(["d"]);
    expect(root.total).toBe(5);

    const ml = snap.collections.get("ML")!;
    expect(ml).toMatchObject({ rel: "ML", name: "ML", parent: "", children: ["ML/Vision"], total: 3 });
    expect(ml.paperIds.sort()).toEqual(["a", "b"]);

    const vision = snap.collections.get("ML/Vision")!;
    expect(vision).toMatchObject({ rel: "ML/Vision", name: "Vision", parent: "ML", children: [], paperIds: ["c"], total: 1 });

    expect(snap.collections.get("Bio")).toMatchObject({ parent: "", total: 1, paperIds: ["e"] });
    expect(snap.collections.get("Empty")).toMatchObject({ parent: "", total: 0, paperIds: [], children: [] });
  });

  it("sorts sibling collections by name, case-insensitively and numerically", async () => {
    const lib = await createTempLibrary();
    for (const name of ["Zeta", "alpha", "Beta", "Set 10", "Set 2"]) { await lib.addCollection(name); }
    const snap = await scanLibrary(lib.paths);
    expect(snap.collections.get("")!.children).toEqual(["alpha", "Beta", "Set 2", "Set 10", "Zeta"]);
  });

  it("ignores loose files directly under papers/ and inside collections", async () => {
    const lib = await createTempLibrary([{ id: "a", collection: "ML" }]);
    await fs.writeFile(path.join(lib.paths.papersRoot(), "README.md"), "notes");
    await fs.writeFile(path.join(lib.paths.collectionDir("ML"), "loose.pdf"), fakePdfBytes());
    const snap = await scanLibrary(lib.paths);
    expect([...snap.collections.keys()].sort()).toEqual(["", "ML"]);
    expect([...snap.papers.keys()]).toEqual(["a"]);
    expect(snap.orphans).toEqual([]);
  });

  it("does not treat a paper folder as a collection or look inside it", async () => {
    const lib = await createTempLibrary([{ id: "outer", collection: "ML" }]);
    const nested = path.join(lib.paperDir("outer", "ML"), "attachments", "inner");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "metadata.yaml"), "title: Hidden\n");
    const snap = await scanLibrary(lib.paths);
    expect([...snap.papers.keys()]).toEqual(["outer"]);
    expect([...snap.collections.keys()].sort()).toEqual(["", "ML"]);
  });

  it("ignores dot-folders at every level", async () => {
    const lib = await createTempLibrary([{ id: "visible", collection: "ML" }]);
    await lib.addPaper({ id: "hidden1", collection: ".hidden" });
    await lib.addPaper({ id: "hidden2", collection: "ML/.cache" });
    const snap = await scanLibrary(lib.paths);
    expect([...snap.papers.keys()]).toEqual(["visible"]);
    expect([...snap.collections.keys()].sort()).toEqual(["", "ML"]);
  });

  it("does not scan .research/ (sidecars are not papers)", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [], theme: "auto" } }]);
    await fs.writeFile(path.join(lib.paths.paperDataRoot(), "p1", "metadata.yaml"), "title: not a paper\n");
    const snap = await scanLibrary(lib.paths);
    expect([...snap.papers.keys()]).toEqual(["p1"]);
  });
});

describe("scanLibrary: papers", () => {
  it("reads a metadata.yaml folder as a paper whose id is the folder name", async () => {
    const lib = await createTempLibrary([{
      id: "vaswani2017attention",
      collection: "ML",
      title: "Attention Is All You Need",
      meta: {
        citekey: "vaswani2017attention",
        authors: ["Ashish Vaswani", "Noam Shazeer"],
        year: 2017,
        status: "reading",
        journal: "NeurIPS",
        doi: "10.5555/3295222.3295349",
        tags: ["nlp", "transformers"],
        note: "Read section 3 again",
        keywords: ["attention"],
        summary: "The Transformer.",
      },
    }]);
    const snap = await scanLibrary(lib.paths);
    const entry = snap.papers.get("vaswani2017attention")!;
    expect(entry.collection).toBe("ML");
    expect(entry.record).toMatchObject({
      id: "vaswani2017attention",
      title: "Attention Is All You Need",
      citeKey: "vaswani2017attention",
      status: "reading",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      journal: "NeurIPS",
      doi: "10.5555/3295222.3295349",
      tags: ["nlp", "transformers"],
      note: "Read section 3 again",
      keywords: ["attention"],
      summary: "The Transformer.",
      path: lib.paperDir("vaswani2017attention", "ML"),
    });
  });

  it("takes the id from the folder even when the citekey in metadata.yaml differs", async () => {
    const lib = await createTempLibrary([{ id: "folder-name", meta: { citekey: "other-key" } }]);
    const entry = (await scanLibrary(lib.paths)).papers.get("folder-name")!;
    expect(entry.record.id).toBe("folder-name");
    expect(entry.record.citeKey).toBe("other-key");
  });

  it("falls back to the id for a missing title and citekey", async () => {
    const lib = await createTempLibrary([{ id: "no-title", title: null, rawMetadata: "status: done\n" }]);
    const record = (await scanLibrary(lib.paths)).papers.get("no-title")!.record;
    expect(record.title).toBe("no-title");
    expect(record.citeKey).toBe("no-title");
  });

  it("defaults the status to unread and rejects unknown statuses", async () => {
    const lib = await createTempLibrary([
      { id: "p-none" },
      { id: "p-bad", meta: { status: "finished" } },
      { id: "p-done", meta: { status: "done" } },
    ]);
    const { papers } = await scanLibrary(lib.paths);
    expect(papers.get("p-none")!.record.status).toBe("unread");
    expect(papers.get("p-bad")!.record.status).toBe("unread");
    expect(papers.get("p-done")!.record.status).toBe("done");
  });

  it("derives hasPdf and pdfBytes from paper.pdf, never from the file's content", async () => {
    const lib = await createTempLibrary([
      { id: "with-pdf", pdf: "%PDF-1.4 hello" },
      { id: "no-pdf", meta: { hasPdf: true } },
    ]);
    const { papers } = await scanLibrary(lib.paths);
    const withPdf = papers.get("with-pdf")!;
    expect(withPdf.record.hasPdf).toBe(true);
    expect(withPdf.pdfBytes).toBe("%PDF-1.4 hello".length);
    const without = papers.get("no-pdf")!;
    expect(without.record.hasPdf).toBe(false);
    expect(without.pdfBytes).toBeUndefined();
    expect("pdfBytes" in without).toBe(false);
  });

  it("counts a symlinked paper.pdf as present, like the VS Code indexer", async () => {
    const lib = await createTempLibrary([{ id: "linked" }]);
    const folder = lib.paperDir("linked");
    await fs.writeFile(path.join(folder, "real.pdf"), fakePdfBytes());
    await fs.symlink(path.join(folder, "real.pdf"), path.join(folder, "paper.pdf"));
    const entry = (await scanLibrary(lib.paths)).papers.get("linked")!;
    expect(entry.record.hasPdf).toBe(true);
    expect(entry.pdfBytes).toBeGreaterThan(0);
  });

  it("records the mtime of metadata.yaml as modifiedMs", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    const when = new Date("2024-02-03T04:05:06.000Z");
    await setMtime(path.join(lib.paperDir("p1"), "metadata.yaml"), when);
    const entry = (await scanLibrary(lib.paths)).papers.get("p1")!;
    expect(Math.round(entry.modifiedMs)).toBe(when.getTime());
  });

  it("ignores wrong-typed values (authors not a list, year as a string) without failing", async () => {
    const lib = await createTempLibrary([{ id: "p1", meta: { vscodeOnly: { nested: [1, 2] }, authors: "not a list", year: "2017" } }]);
    const record = (await scanLibrary(lib.paths)).papers.get("p1")!.record;
    expect(record.authors).toBeUndefined();
    expect(record.year).toBeUndefined();
  });

  it("reads non-string list entries safely (tags with numbers are dropped)", async () => {
    const lib = await createTempLibrary([{ id: "p1", meta: { tags: ["ok", 5, null, "also"] } }]);
    expect((await scanLibrary(lib.paths)).papers.get("p1")!.record.tags).toEqual(["ok", "also"]);
  });
});

describe("scanLibrary: orphans, duplicates and broken files", () => {
  it("reports a folder with only paper.pdf as an orphan: not a paper, not a collection", async () => {
    const lib = await createTempLibrary([{ id: "real", collection: "ML" }]);
    const orphan = path.join(lib.paths.collectionDir("ML"), "loose");
    await fs.mkdir(orphan, { recursive: true });
    await fs.writeFile(path.join(orphan, "paper.pdf"), fakePdfBytes());
    const rootOrphan = path.join(lib.paths.papersRoot(), "rootloose");
    await fs.mkdir(rootOrphan);
    await fs.writeFile(path.join(rootOrphan, "paper.pdf"), fakePdfBytes());

    const snap = await scanLibrary(lib.paths);

    expect(snap.orphans).toEqual([orphan, rootOrphan].sort());
    expect([...snap.papers.keys()]).toEqual(["real"]);
    expect([...snap.collections.keys()].sort()).toEqual(["", "ML"]);
    expect(snap.collections.get("ML")!.children).toEqual([]);
  });

  it("keeps the first folder by path when two folders share a paper id, and reports the other", async () => {
    const lib = await createTempLibrary([
      { id: "dup", collection: "B", title: "Second copy" },
      { id: "dup", collection: "A", title: "First copy" },
    ]);
    const snap = await scanLibrary(lib.paths);
    expect(snap.papers.size).toBe(1);
    expect(snap.papers.get("dup")!.record.title).toBe("First copy");
    expect(snap.papers.get("dup")!.collection).toBe("A");
    expect(snap.duplicates).toEqual([lib.paperDir("dup", "B")]);
    // The loser does not count towards its collection.
    expect(snap.collections.get("B")).toMatchObject({ paperIds: [], total: 0 });
    expect(snap.collections.get("A")).toMatchObject({ paperIds: ["dup"], total: 1 });
  });

  it("is deterministic about duplicates across scans", async () => {
    const lib = await createTempLibrary([
      { id: "dup", collection: "Z", title: "z" },
      { id: "dup", collection: "M", title: "m" },
      { id: "dup", collection: "A", title: "a" },
    ]);
    for (let i = 0; i < 3; i++) {
      expect((await scanLibrary(lib.paths)).papers.get("dup")!.record.title).toBe("a");
    }
  });

  it("skips unparseable, empty and non-mapping metadata.yaml, without turning those folders into collections", async () => {
    const lib = await createTempLibrary([
      { id: "good" },
      { id: "broken-yaml", rawMetadata: "title: [unclosed\n  - nope: : :\n" },
      { id: "empty-file", rawMetadata: "" },
      { id: "list-yaml", rawMetadata: "- a\n- b\n" },
      { id: "scalar-yaml", rawMetadata: "just some text\n" },
    ]);
    const snap = await scanLibrary(lib.paths);
    expect([...snap.papers.keys()]).toEqual(["good"]);
    expect([...snap.collections.keys()]).toEqual([""]);
    expect(snap.duplicates).toEqual([]);
    expect(snap.collections.get("")!.total).toBe(1);
  });
});

describe("readPaperFolder", () => {
  it("reads one folder, resolving its collection", async () => {
    const lib = await createTempLibrary([{ id: "p1", collection: "ML/Vision", pdf: true, meta: { status: "done" } }]);
    const entry = await readPaperFolder(lib.paths, lib.paperDir("p1", "ML/Vision"));
    expect(entry?.collection).toBe("ML/Vision");
    expect(entry?.record).toMatchObject({ id: "p1", status: "done", hasPdf: true });
  });

  it("returns undefined when metadata.yaml is missing or not a mapping", async () => {
    const lib = await createTempLibrary([{ id: "bad", rawMetadata: "- x\n" }]);
    expect(await readPaperFolder(lib.paths, lib.paperDir("bad"))).toBeUndefined();
    expect(await readPaperFolder(lib.paths, path.join(lib.paths.papersRoot(), "nowhere"))).toBeUndefined();
  });
});

describe("papersUnder", () => {
  it("returns every paper for the root and only the subtree for a collection", async () => {
    const lib = await createTempLibrary([
      { id: "r" },
      { id: "m1", collection: "ML" },
      { id: "m2", collection: "ML/Vision" },
      { id: "m3", collection: "ML/Vision/Detection" },
      { id: "x1", collection: "ML2" },
      { id: "b1", collection: "Bio" },
    ]);
    const snap = await scanLibrary(lib.paths);
    const ids = (rel: string): string[] => papersUnder(snap, rel).map((e) => e.record.id).sort();

    expect(ids("")).toEqual(["b1", "m1", "m2", "m3", "r", "x1"]);
    expect(ids("ML")).toEqual(["m1", "m2", "m3"]);
    expect(ids("ML/Vision")).toEqual(["m2", "m3"]);
    expect(ids("Bio")).toEqual(["b1"]);
    expect(ids("Nope")).toEqual([]);
  });

  it("does not mistake a sibling whose name starts with the collection name for a child", async () => {
    const lib = await createTempLibrary([{ id: "in", collection: "ML" }, { id: "out", collection: "ML2" }]);
    const snap = await scanLibrary(lib.paths);
    expect(papersUnder(snap, "ML").map((e) => e.record.id)).toEqual(["in"]);
  });
});
