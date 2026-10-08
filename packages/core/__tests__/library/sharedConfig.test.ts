import {
  mergeSharedConfig, parseSharedConfig, serializeSharedConfig, type SharedConfig,
} from "../../src/library/sharedConfig";

describe("parseSharedConfig", () => {
  it.each([
    ["garbage text", "{ not json"],
    ["an empty file", ""],
    ["a JSON array", "[1, 2]"],
    ["a JSON scalar", "42"],
    ["JSON null", "null"],
  ])("reads %s as empty", (_name, text) => {
    expect(parseSharedConfig(text)).toEqual({ version: 1 });
  });

  it("keeps every key, including the ones it does not know", () => {
    const text = JSON.stringify({
      version: 1, libraryRoot: "/data/lib", terminal: { sort: "year" }, vscode: { somethingNew: [1, 2, 3] },
    });
    expect(parseSharedConfig(text)).toEqual({
      version: 1, libraryRoot: "/data/lib", terminal: { sort: "year" }, vscode: { somethingNew: [1, 2, 3] },
    });
  });

  it("forces version 1", () => {
    expect(parseSharedConfig(JSON.stringify({ version: 7, libraryRoot: "/x" })).version).toBe(1);
    expect(parseSharedConfig(JSON.stringify({ libraryRoot: "/x" })).version).toBe(1);
  });
});

describe("mergeSharedConfig", () => {
  it("overrides top-level values and keeps keys the patch does not mention", () => {
    const current: SharedConfig = { version: 1, libraryRoot: "/one", vscode: { lastOpened: "p1" } };
    expect(mergeSharedConfig(current, { libraryRoot: "/two" }))
      .toEqual({ version: 1, libraryRoot: "/two", vscode: { lastOpened: "p1" } });
  });

  it("merges a namespace one level deep instead of replacing it", () => {
    const current: SharedConfig = { version: 1, terminal: { pdfViewer: "zathura", sort: "title" } };
    expect(mergeSharedConfig(current, { terminal: { sort: "year", sortReverse: true } }).terminal)
      .toEqual({ pdfViewer: "zathura", sort: "year", sortReverse: true });
  });

  it("replaces nested values below the first level", () => {
    const current: SharedConfig = { version: 1, terminal: { nested: { a: 1, b: 2 } } };
    expect(mergeSharedConfig(current, { terminal: { nested: { a: 9 } } }).terminal).toEqual({ nested: { a: 9 } });
  });

  it("replaces a value when either side is not an object", () => {
    expect(mergeSharedConfig({ version: 1, terminal: "x" }, { terminal: { sort: "year" } }).terminal)
      .toEqual({ sort: "year" });
    expect(mergeSharedConfig({ version: 1, terminal: { sort: "year" } }, { terminal: [1] }).terminal).toEqual([1]);
  });

  it("removes a key patched to undefined", () => {
    const merged = mergeSharedConfig({ version: 1, libraryRoot: "/lib", terminal: {} }, { libraryRoot: undefined });
    expect(merged).toEqual({ version: 1, terminal: {} });
    expect("libraryRoot" in merged).toBe(false);
  });

  it("forces version 1 and does not mutate its inputs", () => {
    const current = { version: 9 } as unknown as SharedConfig;
    const patch = { libraryRoot: "/x" };
    expect(mergeSharedConfig(current, patch).version).toBe(1);
    expect(current).toEqual({ version: 9 });
    expect(patch).toEqual({ libraryRoot: "/x" });
  });
});

describe("serializeSharedConfig", () => {
  it("writes indented JSON with a trailing newline", () => {
    expect(serializeSharedConfig({ version: 1, libraryRoot: "/data/lib" }))
      .toBe('{\n  "version": 1,\n  "libraryRoot": "/data/lib"\n}\n');
  });
});
