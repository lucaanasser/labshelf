import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CONFIG_FILE, configPath, loadConfig, resolveLibraryRoot, updateConfig } from "../../src/app/config";
import { cacheDir, configDir, expandHome } from "../../src/platform/dirs";
import { cleanupTempDirs, listFiles, makeTempDir } from "../fixtures/library";

afterEach(cleanupTempDirs);

async function configFile(): Promise<{ dir: string; file: string }> {
  const dir = await makeTempDir();
  return { dir, file: path.join(dir, "labshelf", CONFIG_FILE) };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

describe("config and cache locations", () => {
  it("puts the config in $XDG_CONFIG_HOME/labshelf/config.json", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg/config" })).toBe(path.join("/xdg/config", "labshelf"));
    expect(configPath({ XDG_CONFIG_HOME: "/xdg/config" })).toBe(path.join("/xdg/config", "labshelf", "config.json"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset or empty", () => {
    const expected = path.join(os.homedir(), ".config", "labshelf", "config.json");
    expect(configPath({})).toBe(expected);
    expect(configPath({ XDG_CONFIG_HOME: "" })).toBe(expected);
  });

  it("puts caches in $XDG_CACHE_HOME/labshelf when set", () => {
    expect(cacheDir({ XDG_CACHE_HOME: "/xdg/cache" })).toBe(path.join("/xdg/cache", "labshelf"));
  });

  it("expands a leading ~ to the home directory", () => {
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("~/papers")).toBe(path.join(os.homedir(), "papers"));
    expect(expandHome("/abs/~/papers")).toBe("/abs/~/papers");
    expect(expandHome("~other/x")).toBe("~other/x");
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});

describe("loadConfig", () => {
  it("reads as empty when the file does not exist", async () => {
    const { file } = await configFile();
    expect(await loadConfig(file)).toEqual({ version: 1 });
  });

  it.each([
    ["garbage text", "{ not json"],
    ["an empty file", ""],
    ["a JSON array", "[1, 2]"],
    ["a JSON scalar", "42"],
    ["JSON null", "null"],
  ])("reads as empty for %s", async (_name, content) => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    expect(await loadConfig(file)).toEqual({ version: 1 });
  });

  it("reads a valid file, including keys it does not know", async () => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      version: 1,
      libraryRoot: "/data/lib",
      terminal: { pdfViewer: "zathura", sort: "year", sortReverse: true, autoSyncMinutes: 15 },
      vscode: { somethingNew: [1, 2, 3] },
    }));
    expect(await loadConfig(file)).toEqual({
      version: 1,
      libraryRoot: "/data/lib",
      terminal: { pdfViewer: "zathura", sort: "year", sortReverse: true, autoSyncMinutes: 15 },
      vscode: { somethingNew: [1, 2, 3] },
    });
  });

  it("always reports version 1", async () => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 7, libraryRoot: "/x" }));
    expect((await loadConfig(file)).version).toBe(1);
  });
});

describe("updateConfig", () => {
  it("creates the file (and its folder) with pretty JSON and a trailing newline", async () => {
    const { file } = await configFile();
    const saved = await updateConfig({ libraryRoot: "/data/lib" }, file);
    expect(saved).toEqual({ version: 1, libraryRoot: "/data/lib" });
    const text = await fs.readFile(file, "utf8");
    expect(text).toBe('{\n  "version": 1,\n  "libraryRoot": "/data/lib"\n}\n');
    expect(await loadConfig(file)).toEqual(saved);
  });

  it("merges the patch into the existing config", async () => {
    const { file } = await configFile();
    await updateConfig({ libraryRoot: "/one" }, file);
    await updateConfig({ libraryRoot: "/two" }, file);
    expect((await loadConfig(file)).libraryRoot).toBe("/two");
  });

  it("preserves keys written by another app (a vscode key) across updates", async () => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 1, libraryRoot: "/lib", vscode: { lastOpened: "p1", nested: { a: [1] } } }));

    const saved = await updateConfig({ terminal: { pdfViewer: "zathura" } }, file);

    expect(saved["vscode"]).toEqual({ lastOpened: "p1", nested: { a: [1] } });
    expect(await readJson(file)).toEqual({
      version: 1,
      libraryRoot: "/lib",
      vscode: { lastOpened: "p1", nested: { a: [1] } },
      terminal: { pdfViewer: "zathura" },
    });
  });

  it("keeps a key another app added between two updates (the file is re-read every time)", async () => {
    const { file } = await configFile();
    await updateConfig({ libraryRoot: "/lib" }, file);
    await fs.writeFile(file, JSON.stringify({ ...(await readJson(file)), vscode: { added: "later" } }));
    await updateConfig({ terminal: { sort: "year" } }, file);
    expect((await readJson(file))["vscode"]).toEqual({ added: "later" });
  });

  it("merges the nested terminal object instead of replacing it", async () => {
    const { file } = await configFile();
    await updateConfig({ terminal: { pdfViewer: "zathura", sort: "title" } }, file);
    const saved = await updateConfig({ terminal: { sort: "year", sortReverse: true } }, file);
    expect(saved.terminal).toEqual({ pdfViewer: "zathura", sort: "year", sortReverse: true });
    expect((await readJson(file))["terminal"]).toEqual({ pdfViewer: "zathura", sort: "year", sortReverse: true });
  });

  it("keeps the existing terminal preferences when the patch does not mention them", async () => {
    const { file } = await configFile();
    await updateConfig({ terminal: { images: "off" } }, file);
    const saved = await updateConfig({ libraryRoot: "/lib" }, file);
    expect(saved.terminal).toEqual({ images: "off" });
  });

  it("forces version 1", async () => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 9 }));
    expect((await updateConfig({ libraryRoot: "/x" }, file)).version).toBe(1);
    expect((await readJson(file))["version"]).toBe(1);
  });

  it("starts over from an unreadable file", async () => {
    const { file } = await configFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ broken");
    expect(await updateConfig({ libraryRoot: "/x" }, file)).toEqual({ version: 1, libraryRoot: "/x" });
  });

  it("leaves only config.json in the config folder (atomic write, no temp files)", async () => {
    const { file } = await configFile();
    await updateConfig({ libraryRoot: "/x" }, file);
    await updateConfig({ libraryRoot: "/y" }, file);
    expect(await listFiles(path.dirname(file))).toEqual(["config.json"]);
  });

  it("survives concurrent updates without producing a corrupt file", async () => {
    const { file } = await configFile();
    await Promise.all(Array.from({ length: 8 }, (_, i) => updateConfig({ terminal: { autoSyncMinutes: i } }, file)));
    const final = await loadConfig(file);
    expect(typeof final.terminal?.autoSyncMinutes).toBe("number");
  });
});

describe("resolveLibraryRoot", () => {
  const home = os.homedir();

  it("prefers the --library flag over LABSHELF_LIBRARY and the config", () => {
    expect(resolveLibraryRoot("/from/flag", { LABSHELF_LIBRARY: "/from/env" }, { version: 1, libraryRoot: "/from/config" }))
      .toEqual({ root: path.resolve("/from/flag"), source: "flag" });
  });

  it("prefers LABSHELF_LIBRARY over the config", () => {
    expect(resolveLibraryRoot(undefined, { LABSHELF_LIBRARY: "/from/env" }, { version: 1, libraryRoot: "/from/config" }))
      .toEqual({ root: path.resolve("/from/env"), source: "env" });
  });

  it("uses the config's libraryRoot last", () => {
    expect(resolveLibraryRoot(undefined, {}, { version: 1, libraryRoot: "/from/config" }))
      .toEqual({ root: path.resolve("/from/config"), source: "config" });
  });

  it("reports none when nothing is configured", () => {
    expect(resolveLibraryRoot(undefined, {}, { version: 1 })).toEqual({ root: undefined, source: "none" });
  });

  it("ignores empty values and a non-string libraryRoot", () => {
    expect(resolveLibraryRoot("", { LABSHELF_LIBRARY: "" }, { version: 1, libraryRoot: "" })).toEqual({ root: undefined, source: "none" });
    expect(resolveLibraryRoot("", { LABSHELF_LIBRARY: "/env" }, { version: 1 }).source).toBe("env");
    const odd = { version: 1, libraryRoot: 42 } as unknown as Parameters<typeof resolveLibraryRoot>[2];
    expect(resolveLibraryRoot(undefined, {}, odd)).toEqual({ root: undefined, source: "none" });
  });

  it("expands ~ in each source", () => {
    expect(resolveLibraryRoot("~/labshelf", {}, { version: 1 }).root).toBe(path.join(home, "labshelf"));
    expect(resolveLibraryRoot(undefined, { LABSHELF_LIBRARY: "~/envlib" }, { version: 1 }).root).toBe(path.join(home, "envlib"));
    expect(resolveLibraryRoot(undefined, {}, { version: 1, libraryRoot: "~/cfglib" }).root).toBe(path.join(home, "cfglib"));
    expect(resolveLibraryRoot("~", {}, { version: 1 }).root).toBe(home);
  });

  it("resolves a relative path against the working directory", () => {
    expect(resolveLibraryRoot("rel/lib", {}, { version: 1 }).root).toBe(path.resolve("rel/lib"));
  });
});
