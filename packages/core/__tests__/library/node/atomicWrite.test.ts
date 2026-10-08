import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../support/tempDirs";

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
