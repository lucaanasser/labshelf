import { diffNamespace } from "../../src/sync/core/syncDiff.js";
import { SyncManifest } from "../../src/sync/core/syncManifest.js";
import type { TreeNode } from "../../src/sync/core/syncTypes.js";
import { MemoryFileSystem } from "./fakes.js";

function localNode(path: string, hash: string): TreeNode {
  return { path, contentHash: hash, modifiedTime: "2026-01-01T00:00:00.000Z" };
}

function remoteNode(path: string, mtime: string): TreeNode {
  return { path, modifiedTime: mtime, remoteId: `r-${path}` };
}

async function emptyManifest(): Promise<SyncManifest> {
  return SyncManifest.load(new MemoryFileSystem(), "/m.json", "fake");
}

async function manifestWith(
  path: string,
  contentHash: string,
  modifiedTime: string,
): Promise<SyncManifest> {
  const m = await emptyManifest();
  m.set("library", path, { remoteId: `r-${path}`, contentHash, modifiedTime });
  return m;
}

describe("diffNamespace three-way classification", () => {
  it("classifies local-new when only local has the path", async () => {
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h1")]]),
      new Map(),
      await emptyManifest(),
    );
    expect(ops[0]).toMatchObject({ path: "a.pdf", class: "local-new" });
  });

  it("classifies remote-new when only remote has the path", async () => {
    const ops = diffNamespace(
      "library",
      new Map(),
      new Map([["a.pdf", remoteNode("a.pdf", "t1")]]),
      await emptyManifest(),
    );
    expect(ops[0]!.class).toBe("remote-new");
  });

  it("classifies unchanged when neither side moved from base", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h1")]]),
      new Map([["a.pdf", remoteNode("a.pdf", "t1")]]),
      m,
    );
    expect(ops[0]!.class).toBe("unchanged");
  });

  it("classifies local-modified when only local content changed", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h2")]]),
      new Map([["a.pdf", remoteNode("a.pdf", "t1")]]),
      m,
    );
    expect(ops[0]!.class).toBe("local-modified");
  });

  it("classifies remote-modified when only remote time changed", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h1")]]),
      new Map([["a.pdf", remoteNode("a.pdf", "t2")]]),
      m,
    );
    expect(ops[0]!.class).toBe("remote-modified");
  });

  it("classifies local-deleted when local is gone and remote unchanged", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map(),
      new Map([["a.pdf", remoteNode("a.pdf", "t1")]]),
      m,
    );
    expect(ops[0]!.class).toBe("local-deleted");
  });

  it("classifies remote-deleted when remote is gone and local unchanged", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h1")]]),
      new Map(),
      m,
    );
    expect(ops[0]!.class).toBe("remote-deleted");
  });

  it("classifies conflict when both sides changed", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", localNode("a.pdf", "h2")]]),
      new Map([["a.pdf", remoteNode("a.pdf", "t2")]]),
      m,
    );
    expect(ops[0]!.class).toBe("conflict");
  });

  it("classifies conflict when both sides created different content with no base", async () => {
    const ops = diffNamespace(
      "library",
      new Map([["a.pdf", { ...localNode("a.pdf", "h1") }]]),
      new Map([["a.pdf", { ...remoteNode("a.pdf", "t1"), contentHash: "h2" }]]),
      await emptyManifest(),
    );
    expect(ops[0]!.class).toBe("conflict");
  });

  it("treats a deleted-then-remotely-modified path as conflict", async () => {
    const m = await manifestWith("a.pdf", "h1", "t1");
    const ops = diffNamespace(
      "library",
      new Map(),
      new Map([["a.pdf", remoteNode("a.pdf", "t2")]]),
      m,
    );
    expect(ops[0]!.class).toBe("conflict");
  });
});
