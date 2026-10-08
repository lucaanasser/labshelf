import { promises as fs } from "node:fs";
import * as path from "node:path";

import { NodeLocalFileSystem } from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

describe("NodeLocalFileSystem (the sync engine's file system)", () => {
  it("lists a folder, and returns [] for one that does not exist", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.mkdir(path.join(dir, "sub"));
    const local = new NodeLocalFileSystem();
    expect((await local.listDir(dir)).sort()).toEqual(["a.txt", "sub"]);
    expect(await local.listDir(path.join(dir, "missing"))).toEqual([]);
  });

  it("lists every name, like VS Code's adapter (both apps must see one tree through the shared manifest)", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "paper.pdf"), "x");
    await fs.writeFile(path.join(dir, ".paper.pdf.1234-abcd.tmp"), "half");
    await fs.writeFile(path.join(dir, ".hidden"), "dotfile");
    expect((await new NodeLocalFileSystem().listDir(dir)).sort()).toEqual([".hidden", ".paper.pdf.1234-abcd.tmp", "paper.pdf"]);
  });

  it("reports a symlink as neither file nor folder, like VS Code's adapter", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "real.pdf"), "x");
    await fs.symlink(path.join(dir, "real.pdf"), path.join(dir, "paper.pdf"));
    const stat = await new NodeLocalFileSystem().stat(path.join(dir, "paper.pdf"));
    expect(stat).toMatchObject({ isFile: false, isDirectory: false });
  });

  it("reads bytes and writes bytes atomically, creating parents", async () => {
    const dir = await makeTempDir();
    const local = new NodeLocalFileSystem(path.join(dir, "tmp"));
    const file = path.join(dir, "deep", "er", "f.bin");
    await local.writeFile(file, new Uint8Array([9, 8, 7]));
    const bytes = await local.readFile(file);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([9, 8, 7]);
    expect(await listFiles(path.join(dir, "tmp"))).toEqual([]);
  });

  it("deletes a file, and does not fail for one that is already gone", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "f.txt");
    await fs.writeFile(file, "x");
    const local = new NodeLocalFileSystem();
    await local.deleteFile(file);
    expect(await pathExists(file)).toBe(false);
    await expect(local.deleteFile(file)).resolves.toBeUndefined();
  });

  it("stats files and folders, and returns undefined for a missing path", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "f.txt");
    await fs.writeFile(file, "12345");
    const local = new NodeLocalFileSystem();
    const fileStat = await local.stat(file);
    expect(fileStat).toMatchObject({ isFile: true, isDirectory: false, size: 5 });
    expect(fileStat!.mtimeMs).toBeGreaterThan(0);
    expect(await local.stat(dir)).toMatchObject({ isFile: false, isDirectory: true });
    expect(await local.stat(path.join(dir, "missing"))).toBeUndefined();
  });

  it("ensureDir creates nested folders", async () => {
    const dir = await makeTempDir();
    await new NodeLocalFileSystem().ensureDir(path.join(dir, "x", "y", "z"));
    expect((await fs.stat(path.join(dir, "x", "y", "z"))).isDirectory()).toBe(true);
  });
});
