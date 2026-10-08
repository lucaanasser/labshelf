import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { NodeLockStore, isProcessAlive } from "../../src/platform/nodeLockStore";
import { cleanupTempDirs, makeTempDir } from "../fixtures/library";

afterEach(cleanupTempDirs);

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

describe("NodeLockStore heartbeats", () => {
  it("writes heartbeats whole: a reader never sees a partial lock", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "google-drive.lock");
    const locks = new NodeLockStore();
    await locks.createExclusive(file, "first");
    await Promise.all(Array.from({ length: 20 }, (_, i) => locks.write(file, `beat-${i}`.repeat(200))));
    expect(await fs.readFile(file, "utf8")).toMatch(/^(beat-\d+)+$/);
    expect((await fs.readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
