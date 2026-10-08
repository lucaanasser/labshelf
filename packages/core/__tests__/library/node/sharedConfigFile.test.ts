import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../../src/ports/index";
import {
  loadSharedConfig, readSharedLibraryRoot, sharedConfigDir, sharedConfigPath, updateSharedConfig,
} from "../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";

afterEach(cleanupTempDirs);

async function configFile(): Promise<string> {
  return path.join(await makeTempDir(), "labshelf", "config.json");
}

async function writeRaw(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

function fakeLogger(): ILogger & { errors: Array<{ module: string; context: Record<string, unknown> | undefined }> } {
  const errors: Array<{ module: string; context: Record<string, unknown> | undefined }> = [];
  return {
    errors,
    log: async () => undefined,
    error: async (module, _error, context) => { errors.push({ module, context }); },
  };
}

describe("shared config location", () => {
  it("lives in $XDG_CONFIG_HOME/labshelf/config.json", () => {
    expect(sharedConfigDir({ XDG_CONFIG_HOME: "/xdg/config" })).toBe(path.join("/xdg/config", "labshelf"));
    expect(sharedConfigPath({ XDG_CONFIG_HOME: "/xdg/config" })).toBe(path.join("/xdg/config", "labshelf", "config.json"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset or empty", () => {
    const expected = path.join(os.homedir(), ".config", "labshelf", "config.json");
    expect(sharedConfigPath({})).toBe(expected);
    expect(sharedConfigPath({ XDG_CONFIG_HOME: "" })).toBe(expected);
  });
});

describe("loadSharedConfig", () => {
  it("reads a missing file as empty without logging", async () => {
    const logger = fakeLogger();
    expect(await loadSharedConfig(await configFile(), logger)).toEqual({ version: 1 });
    expect(logger.errors).toEqual([]);
  });

  it("reads a corrupt file as empty", async () => {
    const file = await configFile();
    await writeRaw(file, "{ broken");
    expect(await loadSharedConfig(file)).toEqual({ version: 1 });
  });

  it("reads a file it cannot read as empty and logs the path", async () => {
    const file = await configFile();
    await fs.mkdir(file, { recursive: true });
    const logger = fakeLogger();
    expect(await loadSharedConfig(file, logger)).toEqual({ version: 1 });
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]?.context).toMatchObject({ file });
  });

  it("reads a valid file with the keys other apps wrote", async () => {
    const file = await configFile();
    await writeRaw(file, JSON.stringify({ version: 1, libraryRoot: "/lib", terminal: { sort: "year" } }));
    expect(await loadSharedConfig(file)).toEqual({ version: 1, libraryRoot: "/lib", terminal: { sort: "year" } });
  });
});

describe("updateSharedConfig", () => {
  it("creates the file and its folder with pretty JSON", async () => {
    const file = await configFile();
    const saved = await updateSharedConfig({ libraryRoot: "/data/lib" }, file);
    expect(saved).toEqual({ version: 1, libraryRoot: "/data/lib" });
    expect(await fs.readFile(file, "utf8")).toBe('{\n  "version": 1,\n  "libraryRoot": "/data/lib"\n}\n');
  });

  it("keeps keys another app wrote and merges the patched namespace", async () => {
    const file = await configFile();
    await writeRaw(file, JSON.stringify({ version: 1, vscode: { lastOpened: "p1" }, terminal: { sort: "title", images: "off" } }));
    await updateSharedConfig({ terminal: { sort: "year" } }, file);
    expect(await readJson(file)).toEqual({
      version: 1, vscode: { lastOpened: "p1" }, terminal: { sort: "year", images: "off" },
    });
  });

  it("re-reads the file on every update, keeping a key added in between", async () => {
    const file = await configFile();
    await updateSharedConfig({ libraryRoot: "/lib" }, file);
    await fs.writeFile(file, JSON.stringify({ ...(await readJson(file)), vscode: { added: "later" } }));
    await updateSharedConfig({ terminal: { sort: "year" } }, file);
    expect((await readJson(file))["vscode"]).toEqual({ added: "later" });
  });

  it("starts over from a corrupt file and forces version 1", async () => {
    const file = await configFile();
    await writeRaw(file, "{ broken");
    expect(await updateSharedConfig({ libraryRoot: "/x" }, file)).toEqual({ version: 1, libraryRoot: "/x" });
    await writeRaw(file, JSON.stringify({ version: 9 }));
    await updateSharedConfig({ libraryRoot: "/x" }, file);
    expect((await readJson(file))["version"]).toBe(1);
  });

  it("removes a key patched to undefined", async () => {
    const file = await configFile();
    await updateSharedConfig({ libraryRoot: "/x" }, file);
    await updateSharedConfig({ libraryRoot: undefined }, file);
    expect(await readJson(file)).toEqual({ version: 1 });
  });

  it("leaves the file untouched when the update changes nothing", async () => {
    const file = await configFile();
    await updateSharedConfig({ libraryRoot: "/lib" }, file);
    const before = (await fs.stat(file)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await updateSharedConfig({ libraryRoot: "/lib" }, file);
    expect((await fs.stat(file)).mtimeMs).toBe(before);
  });

  it("writes atomically: only config.json remains in the folder", async () => {
    const file = await configFile();
    await updateSharedConfig({ libraryRoot: "/x" }, file);
    await updateSharedConfig({ libraryRoot: "/y" }, file);
    expect(await listFiles(path.dirname(file))).toEqual(["config.json"]);
  });

  it("survives concurrent updates without producing a corrupt file", async () => {
    const file = await configFile();
    await Promise.all(Array.from({ length: 8 }, (_, i) => updateSharedConfig({ terminal: { autoSyncMinutes: i } }, file)));
    const terminal = (await readJson(file))["terminal"] as { autoSyncMinutes?: unknown };
    expect(typeof terminal.autoSyncMinutes).toBe("number");
  });
});

describe("readSharedLibraryRoot", () => {
  it("reads nothing from a missing or corrupt file", async () => {
    const file = await configFile();
    expect(await readSharedLibraryRoot(file)).toBeUndefined();
    await writeRaw(file, "{ nope");
    expect(await readSharedLibraryRoot(file)).toBeUndefined();
  });

  it.each([["a relative path", "relative/lib"], ["a ~ path", "~/lib"], ["a non-string", 42]])(
    "ignores %s",
    async (_name, value) => {
      const file = await configFile();
      await writeRaw(file, JSON.stringify({ libraryRoot: value }));
      expect(await readSharedLibraryRoot(file)).toBeUndefined();
    },
  );

  it("returns an absolute path", async () => {
    const file = await configFile();
    await updateSharedConfig({ libraryRoot: "/Users/me/LabShelfLibrary" }, file);
    expect(await readSharedLibraryRoot(file)).toBe("/Users/me/LabShelfLibrary");
  });
});
