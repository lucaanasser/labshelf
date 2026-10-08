import { promises as fs } from "node:fs";
import * as path from "node:path";

import { LibraryRoot, ensureLibraryStructure, looksLikeLibrary } from "../../src/library/libraryRoot";
import { cleanupTempDirs, makeTempDir, pathExists } from "../fixtures/library";

afterEach(cleanupTempDirs);

describe("LibraryRoot", () => {
  it("resolves a relative root to an absolute one", () => {
    expect(new LibraryRoot("some/relative/lib").root).toBe(path.resolve("some/relative/lib"));
    expect(path.isAbsolute(new LibraryRoot("rel").layout.papersRoot())).toBe(true);
  });

  it("lays the library out under the resolved root", () => {
    const root = path.resolve("/data/lib");
    expect(new LibraryRoot(root).layout.paperDataPath("p1")).toBe(path.join(root, ".research", "papers", "p1", "data.json"));
  });
});

describe("collectionDir / relativeCollection", () => {
  const paths = new LibraryRoot(path.resolve("/data/lib"));

  it("maps the empty path to papers/ and nested paths below it", () => {
    expect(paths.collectionDir("")).toBe(paths.layout.papersRoot());
    expect(paths.collectionDir("ML")).toBe(path.join(paths.layout.papersRoot(), "ML"));
    expect(paths.collectionDir("ML/Vision/Detection")).toBe(path.join(paths.layout.papersRoot(), "ML", "Vision", "Detection"));
  });

  it("returns '' for papers/ itself and '/'-separated paths otherwise", () => {
    expect(paths.relativeCollection(paths.layout.papersRoot())).toBe("");
    expect(paths.relativeCollection(path.join(paths.layout.papersRoot(), "ML", "Vision"))).toBe("ML/Vision");
  });

  it.each(["", "ML", "ML/Vision", "Bio/Cells and Tissue/2024", "Ünï cödé/ß"])("round-trips %j", (rel) => {
    expect(paths.relativeCollection(paths.collectionDir(rel))).toBe(rel);
  });
});

describe("ensureLibraryStructure", () => {
  it("creates papers/, .research/papers, .research/sync and .research/logs", async () => {
    const root = await makeTempDir();
    const paths = new LibraryRoot(path.join(root, "fresh", "lib"));
    await ensureLibraryStructure(paths);
    for (const dir of [paths.layout.papersRoot(), paths.layout.paperDataRoot(), paths.layout.syncDir(), paths.layout.logsDir()]) {
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    }
  });

  it("is idempotent and leaves existing content alone", async () => {
    const root = await makeTempDir();
    const paths = new LibraryRoot(root);
    await ensureLibraryStructure(paths);
    const keep = path.join(paths.layout.papersRoot(), "ML", "p1");
    await fs.mkdir(keep, { recursive: true });
    await fs.writeFile(path.join(keep, "metadata.yaml"), "title: x\n");

    await ensureLibraryStructure(paths);

    expect(await fs.readFile(path.join(keep, "metadata.yaml"), "utf8")).toBe("title: x\n");
  });
});

describe("looksLikeLibrary", () => {
  it("is false for an empty folder and for a folder that does not exist", async () => {
    const root = await makeTempDir();
    expect(await looksLikeLibrary(root)).toBe(false);
    expect(await looksLikeLibrary(path.join(root, "missing"))).toBe(false);
  });

  it("is true when papers/ exists", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "papers"));
    expect(await looksLikeLibrary(root)).toBe(true);
  });

  it("is true when only .research/ exists", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, ".research"));
    expect(await looksLikeLibrary(root)).toBe(true);
  });

  it("ignores a plain file called papers", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "papers"), "not a folder");
    expect(await looksLikeLibrary(root)).toBe(false);
  });

  it("recognises a library created by ensureLibraryStructure", async () => {
    const root = await makeTempDir();
    expect(await pathExists(path.join(root, "papers"))).toBe(false);
    await ensureLibraryStructure(new LibraryRoot(root));
    expect(await looksLikeLibrary(root)).toBe(true);
  });
});
