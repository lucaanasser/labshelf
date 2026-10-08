import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  NodeFileSystem,
  NodeLocalFileSystem,
  NodeLockStore,
  isProcessAlive,
  writeFileAtomic,
} from "../../src/platform/nodeFileSystem";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../fixtures/library";

afterEach(cleanupTempDirs);

describe("writeFileAtomic", () => {
  it("writes text and bytes, creating missing parent folders", async () => {
    const dir = await makeTempDir();
    await writeFileAtomic(path.join(dir, "a", "b", "c.txt"), "héllo");
    await writeFileAtomic(path.join(dir, "bytes.bin"), new Uint8Array([0, 1, 2, 255]));
    expect(await fs.readFile(path.join(dir, "a", "b", "c.txt"), "utf8")).toBe("héllo");
    expect([...(await fs.readFile(path.join(dir, "bytes.bin")))]).toEqual([0, 1, 2, 255]);
  });

  it("replaces an existing file", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "f.txt");
    await fs.writeFile(target, "old");
    await writeFileAtomic(target, "new");
    expect(await fs.readFile(target, "utf8")).toBe("new");
  });

  it("leaves no temporary file behind, next to the target or in the given temp folder", async () => {
    const dir = await makeTempDir();
    await writeFileAtomic(path.join(dir, "next", "x.txt"), "1");
    expect(await listFiles(path.join(dir, "next"))).toEqual(["x.txt"]);

    const tmp = path.join(dir, "scratch", "tmp");
    await writeFileAtomic(path.join(dir, "out", "y.txt"), "2", tmp);
    expect(await listFiles(path.join(dir, "out"))).toEqual(["y.txt"]);
    expect(await listFiles(tmp)).toEqual([]);
    expect(await pathExists(tmp)).toBe(true);
  });

  it("cleans up its temp file and rejects when the target cannot be replaced", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "taken");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "inside.txt"), "x");
    const tmp = path.join(dir, "tmp");

    await expect(writeFileAtomic(target, "data", tmp)).rejects.toThrow();

    expect(await listFiles(tmp)).toEqual([]);
    expect(await listFiles(target)).toEqual(["inside.txt"]);
  });

  it("never exposes a half-written file to a concurrent reader", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "big.txt");
    const full = "x".repeat(2_000_000);
    await fs.writeFile(target, "start");
    const lengths = new Set<number>();
    let writing = true;
    const reader = (async () => {
      while (writing) {
        lengths.add((await fs.readFile(target)).length);
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    await writeFileAtomic(target, full);
    writing = false;
    await reader;
    // Every read saw either the whole old content or the whole new content.
    expect(lengths.size).toBeGreaterThan(0);
    expect([...lengths].every((n) => n === "start".length || n === full.length)).toBe(true);
    expect((await fs.readFile(target, "utf8")).length).toBe(full.length);
  });
});

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

  it("writes heartbeats whole: a reader never sees a partial lock", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "google-drive.lock");
    const locks = new NodeLockStore();
    await locks.createExclusive(file, "first");
    await Promise.all(Array.from({ length: 20 }, (_, i) => locks.write(file, `beat-${i}`.repeat(200))));
    expect(await fs.readFile(file, "utf8")).toMatch(/^(beat-\d+)+$/);
    expect((await fs.readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
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

describe("NodeLockStore", () => {
  it("createExclusive succeeds once and then reports false without touching the file", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "sync", "google-drive.lock");
    const locks = new NodeLockStore();
    expect(await locks.createExclusive(file, "first")).toBe(true);
    expect(await locks.createExclusive(file, "second")).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("first");
  });

  it("lets exactly one of many concurrent creators win", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "lock");
    const locks = new NodeLockStore();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => locks.createExclusive(file, `holder-${i}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await fs.readFile(file, "utf8")).toBe(`holder-${results.indexOf(true)}`);
  });

  it("reads, writes and removes", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "lock");
    const locks = new NodeLockStore();
    expect(await locks.read(file)).toBeUndefined();
    await locks.createExclusive(file, "one");
    expect(await locks.read(file)).toBe("one");
    await locks.write(file, "two");
    expect(await locks.read(file)).toBe("two");
    await locks.remove(file);
    expect(await locks.read(file)).toBeUndefined();
    await expect(locks.remove(file)).resolves.toBeUndefined();
  });

  it("allows creating the lock again after it was removed", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "lock");
    const locks = new NodeLockStore();
    await locks.createExclusive(file, "one");
    await locks.remove(file);
    expect(await locks.createExclusive(file, "again")).toBe(true);
  });
});

describe("isProcessAlive", () => {
  it("is true for this process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("is false for a process that has exited", () => {
    const child = spawnSync(process.execPath, ["-e", ""]);
    expect(child.pid).toBeGreaterThan(0);
    expect(isProcessAlive(child.pid)).toBe(false);
  });

  it("is true for a process owned by someone else (EPERM still means it exists)", () => {
    expect(isProcessAlive(1)).toBe(true);
  });
});
