import { promises as fs } from "node:fs";
import * as path from "node:path";

import { NodeFileSystem } from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("NodeFileSystem (IFileSystem for the BibTeX service)", () => {
  it("writes text atomically through the temp folder and reads it back", async () => {
    const dir = await makeTempDir();
    const fsx = new NodeFileSystem(path.join(dir, "tmp"));
    await fsx.writeText(path.join(dir, "papers", "p1", "metadata.yaml"), "title: x\n");
    expect(await fsx.readText(path.join(dir, "papers", "p1", "metadata.yaml"))).toBe("title: x\n");
    expect(await listFiles(path.join(dir, "tmp"))).toEqual([]);
  });

  it("writes beside the target when no temp folder is given", async () => {
    const dir = await makeTempDir();
    await new NodeFileSystem().writeText(path.join(dir, "f.txt"), "x");
    expect(await listFiles(dir)).toEqual(["f.txt"]);
  });

  it("ensureDir is recursive and idempotent", async () => {
    const dir = await makeTempDir();
    const fsx = new NodeFileSystem();
    await fsx.ensureDir(path.join(dir, "a", "b"));
    await fsx.ensureDir(path.join(dir, "a", "b"));
    expect((await fs.stat(path.join(dir, "a", "b"))).isDirectory()).toBe(true);
  });

  it("exists is true for files and folders and false otherwise", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "f.txt"), "x");
    const fsx = new NodeFileSystem();
    expect(await fsx.exists(path.join(dir, "f.txt"))).toBe(true);
    expect(await fsx.exists(dir)).toBe(true);
    expect(await fsx.exists(path.join(dir, "missing"))).toBe(false);
  });

  it("readText rejects for a missing file", async () => {
    const dir = await makeTempDir();
    await expect(new NodeFileSystem().readText(path.join(dir, "missing"))).rejects.toThrow(/ENOENT/);
  });
});
