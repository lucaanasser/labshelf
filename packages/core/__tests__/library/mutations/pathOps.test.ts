import * as path from "node:path";

import { posixPathOps, type PathOps } from "@labshelf/core";

describe("posixPathOps", () => {
  it("agrees with node:path's posix flavour on library paths", () => {
    const cases = ["/lib/papers/ML/p1", "/lib/papers", "papers/ML", "papers", "/"];
    for (const target of cases) {
      expect(posixPathOps.dirname(target)).toBe(path.posix.dirname(target));
      expect(posixPathOps.basename(target)).toBe(path.posix.basename(target));
    }
    expect(posixPathOps.basename("/in/My Paper.pdf", ".pdf")).toBe("My Paper");
    expect(posixPathOps.join("/lib/papers", "ML", "p1")).toBe("/lib/papers/ML/p1");
    expect(posixPathOps.join("papers", "", "p1")).toBe("papers/p1");
    expect(posixPathOps.join("/", "p1")).toBe("/p1");
  });

  it("is a shape node:path satisfies", () => {
    const node: PathOps = path;
    expect(node.sep).toBe(path.sep);
  });
});
