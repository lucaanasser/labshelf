import { SyncEngine, SyncManifest } from "@labshelf/core";
import { MemoryFileSystem, FakeRemoteProvider } from "./fakes.js";

async function build(): Promise<{
  engine: SyncEngine;
  fs: MemoryFileSystem;
  provider: FakeRemoteProvider;
  manifest: SyncManifest;
}> {
  const fs = new MemoryFileSystem();
  const provider = new FakeRemoteProvider();
  const manifest = await SyncManifest.load(fs, "/m.json", "fake");
  const engine = new SyncEngine({
    provider,
    fs,
    manifest,
    roots: { library: "/lib", appdata: "/app" },
    clock: () => new Date("2026-05-16T00:00:00.000Z"),
  });
  return { engine, fs, provider, manifest };
}

describe("SyncEngine.run", () => {
  it("rejects when the provider is not connected", async () => {
    const { engine, provider } = await build();
    provider.setConnected(false);
    await expect(engine.run()).rejects.toThrow("not connected");
  });

  it("uploads new local files and persists the manifest", async () => {
    const { engine, fs, provider, manifest } = await build();
    fs.seed("/lib/papers/a/paper.pdf", "PDF");
    fs.seed("/app/papers/a/data.json", "{}");

    const result = await engine.run();

    const lib = result.namespaces.find((n) => n.namespace === "library")!;
    const app = result.namespaces.find((n) => n.namespace === "appdata")!;
    expect(lib.uploaded).toBe(1);
    expect(app.uploaded).toBe(1);
    expect(manifest.get("library", "papers/a/paper.pdf")).toBeDefined();

    const libRoot = await provider.resolveRoot("library");
    const top = await provider.list(libRoot.id);
    expect(top.map((f) => f.name)).toContain("papers");
  });

  it("downloads remote files missing locally", async () => {
    const { engine, fs, provider } = await build();
    provider.seedFile("library", "shared.md", "from-remote");

    const result = await engine.run();

    const lib = result.namespaces.find((n) => n.namespace === "library")!;
    expect(lib.downloaded).toBe(1);
    expect(fs.text("/lib/shared.md")).toBe("from-remote");
  });

  it("is idempotent: a second run reports no changes", async () => {
    const { engine, fs } = await build();
    fs.seed("/lib/a.md", "content");

    await engine.run();
    const second = await engine.run();

    const lib = second.namespaces.find((n) => n.namespace === "library")!;
    expect(lib.uploaded).toBe(0);
    expect(lib.downloaded).toBe(0);
  });

  it("includes a providerId and timestamps in the result", async () => {
    const { engine } = await build();
    const result = await engine.run();
    expect(result.providerId).toBe("fake");
    expect(result.startedAt).toBe("2026-05-16T00:00:00.000Z");
    expect(result.finishedAt).toBe("2026-05-16T00:00:00.000Z");
  });
});
