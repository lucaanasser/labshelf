import { promises as fs } from "node:fs";
import * as path from "node:path";

import { NodeLibraryFileSystem } from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

async function setup(trash = jest.fn(async (target: string) => fs.rm(target, { recursive: true }))) {
  const dir = await makeTempDir();
  const tmp = path.join(dir, ".research", "tmp");
  return { dir, trash, lfs: new NodeLibraryFileSystem(trash, tmp) };
}

describe("NodeLibraryFileSystem", () => {
  it("reads and writes text and bytes atomically, without leftovers", async () => {
    const { dir, lfs } = await setup();
    await lfs.writeText(path.join(dir, "a", "m.yaml"), "title: A\n");
    await lfs.writeFile(path.join(dir, "a", "paper.pdf"), new Uint8Array([1, 2, 3]));
    expect(await lfs.readText(path.join(dir, "a", "m.yaml"))).toBe("title: A\n");
    expect(await lfs.readFile(path.join(dir, "a", "paper.pdf"))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await listFiles(dir)).toEqual(["a/m.yaml", "a/paper.pdf"]);
  });

  it("creates empty folders and renames them", async () => {
    const { dir, lfs } = await setup();
    await lfs.mkdir(path.join(dir, "ML", "Vision"));
    expect((await lfs.stat(path.join(dir, "ML", "Vision")))?.isDirectory).toBe(true);
    await lfs.rename(path.join(dir, "ML"), path.join(dir, "Bio"));
    expect(await lfs.exists(path.join(dir, "Bio", "Vision"))).toBe(true);
    expect(await lfs.exists(path.join(dir, "ML"))).toBe(false);
  });

  it("hands trash to the injected platform trash and passes its failure on", async () => {
    const { dir, lfs, trash } = await setup();
    await lfs.mkdir(path.join(dir, "ML"));
    await lfs.trash(path.join(dir, "ML"));
    expect(trash).toHaveBeenCalledWith(path.join(dir, "ML"));
    expect(await pathExists(path.join(dir, "ML"))).toBe(false);

    const failing = new NodeLibraryFileSystem(async () => { throw new Error("no trash here"); });
    await expect(failing.trash(dir)).rejects.toThrow("no trash here");
  });

  it("lists a missing folder as empty but fails on a folder it cannot read", async () => {
    const { dir, lfs } = await setup();
    expect(await lfs.listDir(path.join(dir, "missing"))).toEqual([]);
    await fs.writeFile(path.join(dir, "file"), "x");
    await expect(lfs.listDir(path.join(dir, "file"))).rejects.toThrow();
  });

  it("stats a symlink as neither file nor folder", async () => {
    const { dir, lfs } = await setup();
    await fs.writeFile(path.join(dir, "real.pdf"), "x");
    await fs.symlink(path.join(dir, "real.pdf"), path.join(dir, "link.pdf"));
    expect(await lfs.stat(path.join(dir, "link.pdf"))).toMatchObject({ isFile: false, isDirectory: false });
  });
});
