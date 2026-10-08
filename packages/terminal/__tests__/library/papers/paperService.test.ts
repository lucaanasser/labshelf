import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PaperRecord } from "@labshelf/core";

import { harness, metaFile } from "../../fixtures/paperService";
import { cleanupTempDirs, listFiles, pathExists, readYaml, type PaperFixture } from "../../fixtures/library";

afterEach(cleanupTempDirs);

describe("updateFields", () => {
  const base: PaperFixture = { id: "p1", collection: "ML", pdf: true, meta: { status: "unread", doi: "10.5555/1" } };

  it("writes the patch, returns the record, reloads the store and tells the sync once", async () => {
    const h = await harness([base]);
    const next = await h.service.updateFields("p1", { status: "reading", tags: ["NLP"], note: "Read section 3 again" });

    expect(next).toMatchObject({ status: "reading", tags: ["NLP"], note: "Read section 3 again" });
    expect(await readYaml(metaFile(h, "p1", "ML"))).toMatchObject({ status: "reading", tags: ["NLP"], doi: "10.5555/1" });
    expect(h.store.paper("p1")!.record.status).toBe("reading");
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("returns undefined and writes nothing for an unknown paper", async () => {
    const h = await harness([base]);
    expect(await h.service.updateFields("ghost", { status: "done" })).toBeUndefined();
    expect(h.onLocalChange).not.toHaveBeenCalled();
  });

  it("finds a paper another app moved to a different collection since the scan", async () => {
    const h = await harness([base], ["Bio"]);
    const moved = h.lib.paperDir("p1", "Bio");
    await fs.rename(h.lib.paperDir("p1", "ML"), moved);

    expect((await h.service.updateFields("p1", { status: "done" }))?.status).toBe("done");
    expect((await readYaml(path.join(moved, "metadata.yaml")))["status"]).toBe("done");
    expect(h.store.paper("p1")!.collection).toBe("Bio");
  });

  it("returns undefined for a paper that was deleted since the scan", async () => {
    const h = await harness([base]);
    await fs.rm(h.lib.paperDir("p1", "ML"), { recursive: true });
    expect(await h.service.updateFields("p1", { status: "done" })).toBeUndefined();
  });
});

describe("setStatus / editTags", () => {
  it("sets the status of several papers with one reload and one sync notification", async () => {
    const h = await harness([{ id: "p1" }, { id: "p2", collection: "ML" }, { id: "p3", meta: { status: "done" } }]);
    const listener = jest.fn();
    h.store.onChange(listener);

    const outcome = await h.service.setStatus(["p1", "p2", "p3"], "done");

    expect(outcome).toEqual({ done: ["p1", "p2", "p3"], failed: [] });
    expect((await readYaml(metaFile(h, "p2", "ML")))["status"]).toBe("done");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("reports unknown ids as failures without stopping the batch", async () => {
    const h = await harness([{ id: "p1" }, { id: "p2" }]);
    const outcome = await h.service.setStatus(["p1", "ghost", "p2"], "reading");
    expect(outcome.done).toEqual(["p1", "p2"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
  });

  it("finds papers another app moved since the scan", async () => {
    const h = await harness([{ id: "p1", collection: "ML" }], ["Bio"]);
    await fs.rename(h.lib.paperDir("p1", "ML"), h.lib.paperDir("p1", "Bio"));
    expect(await h.service.setStatus(["p1"], "done")).toEqual({ done: ["p1"], failed: [] });
    expect((await readYaml(metaFile(h, "p1", "Bio")))["status"]).toBe("done");
  });

  it("adds and removes tags per paper, keeping each paper's other tags", async () => {
    const h = await harness([{ id: "p1", meta: { tags: ["a", "b"] } }, { id: "p2", meta: { tags: ["B", "c"] } }]);
    const outcome = await h.service.editTags(["p1", "p2"], ["new"], ["b"]);
    expect(outcome).toEqual({ done: ["p1", "p2"], failed: [] });
    expect((await readYaml(metaFile(h, "p1")))["tags"]).toEqual(["a", "new"]);
    expect((await readYaml(metaFile(h, "p2")))["tags"]).toEqual(["c", "new"]);
  });
});

describe("movePapers", () => {
  it("moves the paper folder into the collection and updates the store", async () => {
    const h = await harness([{ id: "p1", collection: "ML", pdf: true, sidecar: { annotations: [] } }], ["Bio"]);
    expect(await h.service.movePapers(["p1"], "Bio")).toEqual({ done: ["p1"], failed: [] });
    expect(await listFiles(h.lib.paperDir("p1", "Bio"))).toEqual(["metadata.yaml", "paper.pdf"]);
    expect(h.store.paper("p1")).toMatchObject({ collection: "Bio" });
    expect(await pathExists(h.lib.paths.layout.paperDataPath("p1"))).toBe(true);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("moves to the library root with an empty collection path", async () => {
    const h = await harness([{ id: "p1", collection: "ML/Vision" }]);
    expect(await h.service.movePapers(["p1"], "")).toEqual({ done: ["p1"], failed: [] });
    expect(h.store.paper("p1")!.collection).toBe("");
  });

  it("reports unknown ids and a missing collection", async () => {
    const h = await harness([{ id: "a" }, { id: "b" }], ["Dest"]);
    const outcome = await h.service.movePapers(["a", "ghost", "b"], "Dest");
    expect(outcome.done).toEqual(["a", "b"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);

    const missing = await h.service.movePapers(["a"], "Nowhere");
    expect(missing.failed).toEqual([{ id: "a", error: 'The folder "Nowhere" does not exist' }]);
  });
});

describe("trashPapers", () => {
  it("hands the paper folder to the injected trash and drops the paper from the store", async () => {
    const h = await harness([{ id: "p1", collection: "ML", sidecar: { annotations: [] } }, { id: "p2" }]);
    expect(await h.service.trashPapers(["p1"])).toEqual({ done: ["p1"], failed: [] });
    expect(h.trashed).toEqual([h.lib.paperDir("p1", "ML")]);
    expect(h.store.paper("p1")).toBeUndefined();
    expect(h.store.paper("p2")).toBeDefined();
    expect(await pathExists(h.lib.paths.layout.paperDataPath("p1"))).toBe(true);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown id and a trash failure, and continues with the rest", async () => {
    const h = await harness([{ id: "a" }, { id: "b" }]);
    h.trash.mockImplementationOnce(async () => { throw new Error("trash is full"); });
    const outcome = await h.service.trashPapers(["a", "ghost", "b"]);
    expect(outcome.done).toEqual(["b"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }, { id: "a", error: "trash is full" }]);
    expect(await pathExists(h.lib.paperDir("a"))).toBe(true);
  });
});

describe("collections", () => {
  it("creates a collection below another one and returns its relative path", async () => {
    const h = await harness();
    expect(await h.service.createCollection("", "ML")).toBe("ML");
    expect(await h.service.createCollection("ML", "Vision")).toBe("ML/Vision");
    expect(h.store.collection("ML/Vision")).toBeDefined();
    expect(h.onLocalChange).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid name and a name that exists", async () => {
    const h = await harness([], ["ML"]);
    await expect(h.service.createCollection("", "a/b")).rejects.toThrow("Use a name without slashes.");
    await expect(h.service.createCollection("", "ML")).rejects.toThrow('"ML" already exists');
    expect(h.onLocalChange).not.toHaveBeenCalled();
  });

  it("renames a nested collection in place; its papers follow", async () => {
    const h = await harness([{ id: "p1", collection: "ML/Vision" }]);
    expect(await h.service.renameCollection("ML/Vision", "Sight")).toBe("ML/Sight");
    expect(h.store.paper("p1")!.collection).toBe("ML/Sight");
  });

  it("refuses to rename or delete the library root", async () => {
    const h = await harness([{ id: "p1" }]);
    await expect(h.service.renameCollection("", "X")).rejects.toThrow("The library root cannot be renamed");
    await expect(h.service.trashCollection("")).rejects.toThrow("The library root cannot be deleted");
    expect(h.trash).not.toHaveBeenCalled();
  });

  it("moves a collection under another one, or to the root", async () => {
    const h = await harness([{ id: "p1", collection: "ML/Vision" }], ["Bio"]);
    expect(await h.service.moveCollection("ML/Vision", "Bio")).toBe("Bio/Vision");
    expect(h.store.paper("p1")!.collection).toBe("Bio/Vision");
    expect(await h.service.moveCollection("Bio/Vision", "")).toBe("Vision");
  });

  it("does nothing when the collection is already in that parent", async () => {
    const h = await harness([], ["ML/Vision"]);
    h.onLocalChange.mockClear();
    expect(await h.service.moveCollection("ML/Vision", "ML")).toBe("ML/Vision");
  });

  it("rejects moving a collection into itself", async () => {
    const h = await harness([], ["ML/Vision"]);
    await expect(h.service.moveCollection("ML", "ML/Vision")).rejects.toThrow("A folder cannot be moved into itself.");
  });

  it("trashes the folder with its papers and updates the store; a failed trash passes the error on", async () => {
    const h = await harness([{ id: "p1", collection: "ML" }, { id: "p2" }]);
    h.trash.mockRejectedValueOnce(new Error("no trash here"));
    await expect(h.service.trashCollection("ML")).rejects.toThrow("no trash here");
    expect(h.store.paper("p1")).toBeDefined();
    expect(h.onLocalChange).not.toHaveBeenCalled();

    await h.service.trashCollection("ML");
    expect(h.trashed).toEqual([h.lib.paths.collectionDir("ML")]);
    expect(h.store.paper("p1")).toBeUndefined();
    expect(h.store.paper("p2")).toBeDefined();
  });
});

describe("bibtexFor", () => {
  const records: PaperRecord[] = [
    { id: "a", citeKey: "a", title: "First", path: "/lib/papers/a", status: "unread", authors: ["Ann Lee"], year: 2020, doi: "10.1/a" },
    { id: "b", citeKey: "b", title: "Second {braced}", path: "/lib/papers/b", status: "done", hasPdf: true },
  ];

  it("renders entries separated by a blank line, without the local file line", async () => {
    const h = await harness();
    const text = h.service.bibtexFor(records);
    expect(text).not.toContain("file =");
    expect(text).toContain("@article{a,");
    expect(text).toContain("title = {Second braced}");
    expect(text).toContain("},\n  keywords = {labshelf, imported}\n}\n\n@article{b,");
    expect(text.endsWith("}\n")).toBe(true);
  });
});
