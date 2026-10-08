import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createLogEntry } from "../../../src/logging/index";
import { FileLogSink } from "../../../src/logging/node/index";
import type { LogEntry } from "../../../src/model/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

const entry = (message: string): LogEntry => createLogEntry("INFO", "test", message);

async function readEntries(file: string): Promise<LogEntry[]> {
  const text = await fs.readFile(file, "utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
}

describe("FileLogSink", () => {
  it("writes one JSON line per entry", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "app.log");
    const sink = new FileLogSink(file);
    await sink.append(entry("one"));
    await sink.append(entry("two"));
    const text = await fs.readFile(file, "utf8");
    expect(text.split("\n")).toHaveLength(3);
    expect((await readEntries(file)).map((e) => e.message)).toEqual(["one", "two"]);
  });

  it("creates the missing directory", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "deep", "logs", "app.log");
    await new FileLogSink(file).append(entry("x"));
    expect(await readEntries(file)).toHaveLength(1);
  });

  it("keeps every entry, in order, when 50 appends run at once", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "app.log");
    const sink = new FileLogSink(file);
    await Promise.all(Array.from({ length: 50 }, (_, i) => sink.append(entry(`m${i}`))));
    expect((await readEntries(file)).map((e) => e.message)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i}`));
  });

  it("keeps earlier lines already on disk", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "app.log");
    await fs.writeFile(file, `${JSON.stringify(entry("old"))}\n`);
    await new FileLogSink(file).append(entry("new"));
    expect((await readEntries(file)).map((e) => e.message)).toEqual(["old", "new"]);
  });

  it("rotates to <file>.1 past maxBytes and overwrites the previous rotation", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "app.log");
    const sink = new FileLogSink(file, { maxBytes: 200 });
    for (let i = 0; i < 20; i++) await sink.append(entry(`message number ${i}`));
    expect(await listFiles(dir)).toEqual(["app.log", "app.log.1"]);
    const current = await readEntries(file);
    const rotated = await readEntries(`${file}.1`);
    expect(current.length).toBeGreaterThan(0);
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated[rotated.length - 1]?.message).not.toBe("message number 19");
    expect(current[current.length - 1]?.message).toBe("message number 19");
    expect(rotated.length + current.length).toBeLessThanOrEqual(20);
  });

  it("rejects the failing append and still accepts the next one", async () => {
    const dir = await makeTempDir();
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "");
    const broken = new FileLogSink(path.join(blocker, "app.log"));
    await expect(broken.append(entry("a"))).rejects.toThrow();
    await expect(broken.append(entry("b"))).rejects.toThrow();
    const ok = new FileLogSink(path.join(dir, "ok.log"));
    await ok.append(entry("c"));
    expect(await readEntries(path.join(dir, "ok.log"))).toHaveLength(1);
  });
});
