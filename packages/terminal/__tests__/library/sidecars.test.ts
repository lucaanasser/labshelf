import { promises as fs } from "node:fs";
import * as path from "node:path";

import { PaperDataStore, normalizePaperData, serializePaperData } from "@labshelf/core";

import { NodeSidecarPort, SidecarReader } from "../../src/library/sidecars";
import { cleanupTempDirs, createTempLibrary, listFiles, setMtime } from "../fixtures/library";

afterEach(cleanupTempDirs);

function annotation(id: string, pageNumber: number, createdAt: string, content = `text ${id}`): Record<string, unknown> {
  return {
    id, paperId: "p1", type: "highlight", pageNumber, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, createdAt, updatedAt: createdAt,
  };
}

describe("SidecarReader.load", () => {
  it("returns empty data for a paper without a sidecar", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    expect(await new SidecarReader(lib.paths).load("p1")).toEqual({ annotations: [], theme: "auto" });
  });

  it("returns empty data for corrupt or non-object files", async () => {
    const lib = await createTempLibrary([
      { id: "garbage", sidecar: "{ this is not json" },
      { id: "array", sidecar: "[1, 2, 3]" },
      { id: "scalar", sidecar: "42" },
      { id: "empty", sidecar: "" },
    ]);
    const reader = new SidecarReader(lib.paths);
    for (const id of ["garbage", "array", "scalar", "empty"]) {
      expect(await reader.load(id)).toEqual({ annotations: [], theme: "auto" });
    }
  });

  it("reads annotations, theme and reading position", async () => {
    const reading = { page: 4, scaleValue: "1.25", updatedAt: "2025-01-02T00:00:00.000Z" };
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: { annotations: [annotation("a1", 2, "2025-01-01T00:00:00.000Z")], theme: "sepia", reading },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.theme).toBe("sepia");
    expect(data.reading).toMatchObject({ page: 4, scaleValue: "1.25" });
    expect(data.annotations.map((a) => a.id)).toEqual(["a1"]);
  });

  it("drops malformed annotations and unknown themes instead of failing", async () => {
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: { annotations: [annotation("ok", 1, "2025-01-01T00:00:00.000Z"), { content: "no id" }, null, "str"], theme: "neon" },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.annotations.map((a) => a.id)).toEqual(["ok"]);
    expect(data.theme).toBe("auto");
  });

  it("sorts annotations by page, then by creation time", async () => {
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: {
        annotations: [
          annotation("late-p3", 3, "2025-03-01T00:00:00.000Z"),
          annotation("p1-b", 1, "2025-02-02T00:00:00.000Z"),
          annotation("p2", 2, "2025-01-01T00:00:00.000Z"),
          annotation("p1-a", 1, "2025-02-01T00:00:00.000Z"),
          annotation("early-p3", 3, "2025-01-01T00:00:00.000Z"),
        ],
        theme: "auto",
      },
    }]);
    const data = await new SidecarReader(lib.paths).load("p1");
    expect(data.annotations.map((a) => a.id)).toEqual(["p1-a", "p1-b", "p2", "early-p3", "late-p3"]);
  });

  it("caches by mtime: an unchanged file returns the same object", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" } }]);
    const reader = new SidecarReader(lib.paths);
    const first = await reader.load("p1");
    expect(await reader.load("p1")).toBe(first);
  });

  it("picks up an external edit (another app rewrote the sidecar)", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" } }]);
    const file = lib.paths.layout.paperDataPath("p1");
    await setMtime(file, new Date("2024-01-01T00:00:00Z"));
    const reader = new SidecarReader(lib.paths);
    const first = await reader.load("p1");
    expect(first.annotations).toHaveLength(1);

    await fs.writeFile(file, JSON.stringify({
      annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z"), annotation("a2", 2, "2025-01-02T00:00:00.000Z")],
      theme: "dark",
    }));
    await setMtime(file, new Date("2024-06-01T00:00:00Z"));

    const second = await reader.load("p1");
    expect(second).not.toBe(first);
    expect(second.annotations.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(second.theme).toBe("dark");
  });

  it("notices a sidecar that appears or disappears", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    const reader = new SidecarReader(lib.paths);
    expect((await reader.load("p1")).annotations).toEqual([]);

    await lib.writeSidecar("p1", { annotations: [annotation("a1", 1, "2025-01-01T00:00:00.000Z")], theme: "auto" });
    expect((await reader.load("p1")).annotations).toHaveLength(1);

    await fs.rm(lib.paths.layout.paperDataPath("p1"));
    expect((await reader.load("p1")).annotations).toEqual([]);
  });
});

describe("SidecarReader.annotationIndex", () => {
  it("maps each paper with annotations to its annotation text, one per line, in page order", async () => {
    const lib = await createTempLibrary([
      { id: "p1", sidecar: { annotations: [annotation("b", 2, "2025-01-01T00:00:00.000Z", "second page"), annotation("a", 1, "2025-01-01T00:00:00.000Z", "first page")], theme: "auto" } },
      { id: "p2", sidecar: { annotations: [], theme: "dark" } },
      { id: "p3" },
      { id: "p4", sidecar: { annotations: [annotation("c", 1, "2025-01-01T00:00:00.000Z", "only one")], theme: "auto" } },
    ]);
    const index = await new SidecarReader(lib.paths).annotationIndex(["p1", "p2", "p3", "p4", "ghost"]);
    expect([...index.keys()].sort()).toEqual(["p1", "p4"]);
    expect(index.get("p1")).toBe("first page\nsecond page");
    expect(index.get("p4")).toBe("only one");
  });

  it("accepts any iterable of ids (a Map's keys, as the app passes them)", async () => {
    const lib = await createTempLibrary([{ id: "p1", sidecar: { annotations: [annotation("a", 1, "2025-01-01T00:00:00.000Z", "hello")], theme: "auto" } }]);
    const index = await new SidecarReader(lib.paths).annotationIndex(new Map([["p1", 1]]).keys());
    expect(index.get("p1")).toBe("hello");
  });
});

describe("NodeSidecarPort", () => {
  it("reads null for a paper without a sidecar", async () => {
    const lib = await createTempLibrary();
    expect(await new NodeSidecarPort(lib.paths).read("nope")).toBeNull();
  });

  it("writes to .research/papers/<id>/data.json, creating the folder, and reads it back", async () => {
    const lib = await createTempLibrary();
    const port = new NodeSidecarPort(lib.paths);
    await port.write("new-paper", '{"annotations":[],"theme":"auto"}');
    expect(await fs.readFile(path.join(lib.root, ".research", "papers", "new-paper", "data.json"), "utf8")).toBe('{"annotations":[],"theme":"auto"}');
    expect(await port.read("new-paper")).toBe('{"annotations":[],"theme":"auto"}');
  });

  it("overwrites atomically: no temp file is left in the sidecar folder or the temp folder", async () => {
    const lib = await createTempLibrary();
    const port = new NodeSidecarPort(lib.paths);
    await port.write("p1", "first");
    await port.write("p1", "second");
    expect(await port.read("p1")).toBe("second");
    expect(await listFiles(lib.paths.layout.paperDataRoot())).toEqual(["p1/data.json"]);
    expect(await listFiles(lib.paths.layout.tmpDir())).toEqual([]);
  });

  it("produces sidecars the shared reader code reads back (the format VS Code and the browser use)", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    const store = new PaperDataStore(new NodeSidecarPort(lib.paths));
    const highlight = await store.addHighlight("p1", 3, "an important sentence", "green", { x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    await store.setTheme("p1", "dark");
    await store.setReadingState("p1", { page: 3, scaleValue: "page-width", updatedAt: "2025-01-01T00:00:00.000Z" });

    const raw = await fs.readFile(lib.paths.layout.paperDataPath("p1"), "utf8");
    const normalized = normalizePaperData(JSON.parse(raw) as unknown);
    expect(normalized.theme).toBe("dark");
    expect(normalized.annotations).toEqual([highlight]);
    expect(normalized.reading).toMatchObject({ page: 3, scaleValue: "page-width" });
    // Same bytes both extensions write: fixed key order, two-space indent.
    expect(raw).toBe(serializePaperData(normalized));
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(["annotations", "theme", "reading"]);

    const viaReader = await new SidecarReader(lib.paths).load("p1");
    expect(viaReader.annotations.map((a) => a.content)).toEqual(["an important sentence"]);
  });

  it("round-trips a sidecar written by another app and keeps annotations through a terminal-side update", async () => {
    const lib = await createTempLibrary([{
      id: "p1",
      sidecar: { annotations: [annotation("from-vscode", 5, "2025-01-01T00:00:00.000Z", "highlighted in VS Code")], theme: "sepia" },
    }]);
    const store = new PaperDataStore(new NodeSidecarPort(lib.paths));
    await store.setReadingState("p1", { page: 5, scaleValue: "1", updatedAt: "2025-01-02T00:00:00.000Z" });

    const data = normalizePaperData(JSON.parse(await fs.readFile(lib.paths.layout.paperDataPath("p1"), "utf8")) as unknown);
    expect(data.theme).toBe("sepia");
    expect(data.annotations.map((a) => a.id)).toEqual(["from-vscode"]);
    expect(data.reading?.page).toBe(5);
  });
});
