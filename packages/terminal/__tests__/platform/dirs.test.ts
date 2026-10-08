import * as os from "node:os";
import * as path from "node:path";

import { cacheDir, expandHome } from "../../src/platform/dirs";

describe("cache directory and home expansion", () => {
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
