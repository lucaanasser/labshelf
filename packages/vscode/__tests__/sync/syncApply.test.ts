import { applyOperations } from "../../src/sync/syncApply.js";
import type { ApplyContext } from "../../src/sync/syncApply.js";
import { SyncManifest } from "../../src/sync/syncManifest.js";
import { RemotePathResolver } from "../../src/sync/remotePathResolver.js";
import { sha256Hex } from "../../src/sync/contentHash.js";
import type { TreeNode } from "../../src/sync/syncTypes.js";
import { MemoryFileSystem, FakeRemoteProvider } from "./fakes.js";

async function makeContext(): Promise<{
  ctx: ApplyContext;
  fs: MemoryFileSystem;
  provider: FakeRemoteProvider;
  manifest: SyncManifest;
}> {
  const fs = new MemoryFileSystem();
  const provider = new FakeRemoteProvider();
  const manifest = await SyncManifest.load(fs, "/m.json", "fake");
  const root = await provider.resolveRoot("library");
  const ctx: ApplyContext = {
    namespace: "library",
    provider,
    fs,
    manifest,
    resolver: new RemotePathResolver(provider, root.id),
    localRoot: "/lib",
    now: new Date("2026-05-16T00:00:00.000Z"),
  };
  return { ctx, fs, provider, manifest };
}

function localNode(path: string, content: string): TreeNode {
  return {
    path,
    contentHash: sha256Hex(Buffer.from(content, "utf8")),
    modifiedTime: "2026-01-01T00:00:00.000Z",
  };
}

describe("applyOperations", () => {
  it("uploads a local-new file and records the manifest entry", async () => {
    const { ctx, fs, manifest } = await makeContext();
    fs.seed("/lib/papers/a/paper.pdf", "PDF");
    const result = await applyOperations(ctx, [
      {
        path: "papers/a/paper.pdf",
        class: "local-new",
        local: localNode("papers/a/paper.pdf", "PDF"),
      },
    ]);
    expect(result.uploaded).toBe(1);
    expect(manifest.get("library", "papers/a/paper.pdf")).toBeDefined();
  });

  it("downloads a remote-new file to the local tree", async () => {
    const { ctx, fs, provider, manifest } = await makeContext();
    const remote = provider.seedFile("library", "note.md", "hello");
    const result = await applyOperations(ctx, [
      {
        path: "note.md",
        class: "remote-new",
        remote: {
          path: "note.md",
          modifiedTime: remote.modifiedTime,
          remoteId: remote.id,
        },
      },
    ]);
    expect(result.downloaded).toBe(1);
    expect(fs.text("/lib/note.md")).toBe("hello");
    expect(manifest.get("library", "note.md")?.remoteId).toBe(remote.id);
  });

  it("deletes the remote file for a local-deleted op", async () => {
    const { ctx, provider, manifest } = await makeContext();
    const remote = provider.seedFile("library", "old.md", "x");
    manifest.set("library", "old.md", {
      remoteId: remote.id,
      contentHash: "h",
      modifiedTime: remote.modifiedTime,
    });
    const result = await applyOperations(ctx, [
      {
        path: "old.md",
        class: "local-deleted",
        remote: { path: "old.md", modifiedTime: "t", remoteId: remote.id },
      },
    ]);
    expect(result.deletedRemote).toBe(1);
    await expect(provider.download(remote.id)).rejects.toThrow();
    expect(manifest.get("library", "old.md")).toBeUndefined();
  });

  it("deletes the local file for a remote-deleted op", async () => {
    const { ctx, fs, manifest } = await makeContext();
    fs.seed("/lib/gone.md", "bye");
    manifest.set("library", "gone.md", {
      remoteId: "r",
      contentHash: "h",
      modifiedTime: "t",
    });
    const result = await applyOperations(ctx, [
      {
        path: "gone.md",
        class: "remote-deleted",
        local: localNode("gone.md", "bye"),
      },
    ]);
    expect(result.deletedLocal).toBe(1);
    expect(fs.has("/lib/gone.md")).toBe(false);
  });

  it("resolves a conflict with keep-both: renamed remote copy plus local push", async () => {
    const { ctx, fs, provider, manifest } = await makeContext();
    fs.seed("/lib/papers/a/paper.pdf", "LOCAL");
    const remote = provider.seedFile("library", "remote-only", "REMOTE");

    const result = await applyOperations(ctx, [
      {
        path: "papers/a/paper.pdf",
        class: "conflict",
        local: localNode("papers/a/paper.pdf", "LOCAL"),
        remote: {
          path: "papers/a/paper.pdf",
          modifiedTime: remote.modifiedTime,
          remoteId: remote.id,
        },
      },
    ]);

    expect(result.conflicts).toEqual(["papers/a/paper.pdf"]);
    const conflictPath = "papers/a/paper (conflito 2026-05-16).pdf";
    expect(fs.text(`/lib/${conflictPath}`)).toBe("REMOTE");
    expect(manifest.get("library", conflictPath)).toBeDefined();
    expect(manifest.get("library", "papers/a/paper.pdf")).toBeDefined();
    expect(result.uploaded).toBe(1);
    expect(result.downloaded).toBe(1);
  });

  it("skips unchanged operations", async () => {
    const { ctx } = await makeContext();
    const result = await applyOperations(ctx, [
      { path: "a.pdf", class: "unchanged" },
    ]);
    expect(result).toMatchObject({
      uploaded: 0,
      downloaded: 0,
      deletedLocal: 0,
      deletedRemote: 0,
    });
  });
});
