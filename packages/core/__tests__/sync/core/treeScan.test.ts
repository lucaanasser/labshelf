import { scanLocalTree, type ILogger } from "@labshelf/core";

import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

describe("scanLocalTree", () => {
  it("skips a folder it cannot read and logs it, keeping the rest of the tree", async () => {
    const fs = new MemoryLibraryFs();
    await fs.writeText("/lib/papers/a/metadata.yaml", "title: A\n");
    await fs.writeText("/lib/papers/locked/metadata.yaml", "title: B\n");
    fs.unreadable.add("/lib/papers/locked");
    const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const logger: ILogger = {
      log: async (level, _module, message, context) => { logs.push([level, message, context]); },
      error: async () => {},
    };

    const tree = await scanLocalTree(fs, "/lib/papers", logger);

    expect([...tree.keys()]).toEqual(["a/metadata.yaml"]);
    expect(logs).toEqual([
      ["WARN", "Sync skipped a folder it could not read", { dir: "/lib/papers/locked", message: "EACCES: /lib/papers/locked" }],
    ]);
  });

  it("lists a missing root as empty", async () => {
    expect((await scanLocalTree(new MemoryLibraryFs(), "/nowhere")).size).toBe(0);
  });
});
