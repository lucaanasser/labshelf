import * as os from "node:os";
import * as path from "node:path";

import { resolveLibraryRoot } from "../../src/app/config";

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
