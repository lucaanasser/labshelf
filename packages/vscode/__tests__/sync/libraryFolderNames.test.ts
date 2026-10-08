import {
  SyncEngine,
  SyncManifest,
  buildLibraryFolderNames,
  driveFolderName,
  isSafeFolderName,
  readSyncRunRecord,
  summarizeSyncResult,
  writeSyncRunRecord,
  type FolderNameMaps,
  type RemoteProvider,
} from "@labshelf/core";
import { FakeRemoteProvider, MemoryFileSystem } from "./fakes.js";

function metadata(citekey: string, title: string): string {
  return `title: ${title}\ncitekey: ${citekey}\nstatus: unread\n`;
}

async function syncDevice(
  fs: MemoryFileSystem,
  provider: FakeRemoteProvider,
  names?: FolderNameMaps,
): Promise<void> {
  const manifest = await SyncManifest.load(fs, "/m.json", "fake");
  await new SyncEngine({
    provider,
    fs,
    manifest,
    roots: { library: "/lib", appdata: "/app" },
    ...(names ? { libraryFolderNames: names } : {}),
  }).run();
}

async function remoteFolderNames(provider: FakeRemoteProvider): Promise<string[]> {
  const root = await provider.resolveRoot("library");
  return (await provider.list(root.id)).filter((f) => f.isFolder).map((f) => f.name).sort();
}

describe("buildLibraryFolderNames", () => {
  it("maps paper ids to sanitized titles and back", () => {
    const maps = buildLibraryFolderNames([["vaswani2017", " Attention / Is All\u0007 You Need "]]);
    expect(maps.localToRemote.get("vaswani2017")).toBe("Attention  Is All You Need");
    expect(maps.remoteToLocal.get("Attention  Is All You Need")).toBe("vaswani2017");
  });

  it("falls back to the id for an empty title and caps the length", () => {
    expect(driveFolderName("id1", "   ")).toBe("id1");
    expect(driveFolderName("id1", "x".repeat(300))).toHaveLength(255);
  });
});

describe("isSafeFolderName", () => {
  it("accepts cite keys and rejects separators, dots and control characters", () => {
    expect(isSafeFolderName("vaswani2017attention")).toBe(true);
    expect(isSafeFolderName("a/b")).toBe(false);
    expect(isSafeFolderName("..")).toBe(false);
    expect(isSafeFolderName("a\nb")).toBe(false);
    expect(isSafeFolderName("")).toBe(false);
  });
});

describe("library folder naming across devices", () => {
  it("names a paper folder new to this device after its citekey, not its Drive title", async () => {
    const provider = new FakeRemoteProvider();
    const deviceA = new MemoryFileSystem();
    deviceA.seed("/lib/ml/vaswani2017/metadata.yaml", metadata("vaswani2017", "Attention Is All You Need"));
    deviceA.seed("/lib/ml/vaswani2017/paper.pdf", "%PDF-A");
    deviceA.seed("/app/vaswani2017/data.json", '{"annotations":[],"theme":"dark"}');
    await syncDevice(deviceA, provider, buildLibraryFolderNames([["vaswani2017", "Attention Is All You Need"]]));

    // On Drive the folder carries the title, as before.
    const ml = (await provider.list((await provider.resolveRoot("library")).id)).find((f) => f.name === "ml")!;
    expect((await provider.list(ml.id)).map((f) => f.name)).toEqual(["Attention Is All You Need"]);

    // A fresh device that knows no titles still lands on the paper id, so its sidecar lines up.
    const deviceB = new MemoryFileSystem();
    await syncDevice(deviceB, provider, buildLibraryFolderNames([]));
    expect(deviceB.has("/lib/ml/vaswani2017/paper.pdf")).toBe(true);
    expect(deviceB.has("/lib/ml/Attention Is All You Need/paper.pdf")).toBe(false);
    expect(deviceB.text("/app/vaswani2017/data.json")).toContain("dark");
  });

  it("keeps a synced folder in place when the paper's title changes", async () => {
    const provider = new FakeRemoteProvider();
    const device = new MemoryFileSystem();
    device.seed("/lib/vaswani2017/metadata.yaml", metadata("vaswani2017", "Attention"));
    device.seed("/lib/vaswani2017/paper.pdf", "%PDF-A");
    await syncDevice(device, provider, buildLibraryFolderNames([["vaswani2017", "Attention"]]));

    // The title is corrected (e.g. by "fetch metadata"); the next sync knows only the new title.
    device.seed("/lib/vaswani2017/metadata.yaml", metadata("vaswani2017", "Attention Is All You Need"), 5_000);
    await syncDevice(device, provider, buildLibraryFolderNames([["vaswani2017", "Attention Is All You Need"]]));

    expect(device.has("/lib/vaswani2017/paper.pdf")).toBe(true);
    expect(device.paths().filter((p) => p.startsWith("/lib/") && !p.startsWith("/lib/vaswani2017/"))).toEqual([]);
    expect(await remoteFolderNames(provider)).toEqual(["Attention"]);
  });

  it("keeps the local name of a folder synced before, even when it is not the citekey", async () => {
    const provider = new FakeRemoteProvider();
    const device = new MemoryFileSystem();
    // A folder that an older build brought down under its title.
    device.seed("/lib/Evolutionary branching/metadata.yaml", metadata("101007s0028502402145", "Evolutionary branching"));
    await syncDevice(device, provider);
    await syncDevice(device, provider, buildLibraryFolderNames([]));
    expect(device.has("/lib/Evolutionary branching/metadata.yaml")).toBe(true);
    expect(device.has("/lib/101007s0028502402145/metadata.yaml")).toBe(false);
  });

  it("keeps collection names and ignores unsafe citekeys", async () => {
    const provider = new FakeRemoteProvider();
    const deviceA = new MemoryFileSystem();
    deviceA.seed("/lib/Reading group/p1/metadata.yaml", metadata("../evil", "P1"));
    await syncDevice(deviceA, provider);
    const deviceB = new MemoryFileSystem();
    await syncDevice(deviceB, provider, buildLibraryFolderNames([]));
    expect(deviceB.has("/lib/Reading group/p1/metadata.yaml")).toBe(true);
  });
});

describe("sync run record", () => {
  it("summarizes a result and round-trips through the shared file", async () => {
    const fs = new MemoryFileSystem();
    const record = summarizeSyncResult({
      providerId: "google-drive",
      startedAt: "2026-10-08T10:00:00.000Z",
      finishedAt: "2026-10-08T10:00:05.000Z",
      namespaces: [
        { namespace: "library", uploaded: 2, downloaded: 1, deletedLocal: 0, deletedRemote: 1, conflicts: ["a"] },
        { namespace: "appdata", uploaded: 1, downloaded: 0, deletedLocal: 1, deletedRemote: 0, conflicts: [] },
      ],
    }, "vscode", "laptop");
    expect(record).toMatchObject({ app: "vscode", uploaded: 3, downloaded: 1, deletedLocal: 1, deletedRemote: 1, conflicts: ["a"] });
    await writeSyncRunRecord(fs, "/last.json", record);
    expect(await readSyncRunRecord(fs, "/last.json")).toEqual(record);
  });

  it("reads a missing or broken record as never synced", async () => {
    const fs = new MemoryFileSystem();
    expect(await readSyncRunRecord(fs, "/none.json")).toBeUndefined();
    fs.seed("/bad.json", "{");
    expect(await readSyncRunRecord(fs, "/bad.json")).toBeUndefined();
    fs.seed("/nodate.json", '{"app":"x"}');
    expect(await readSyncRunRecord(fs, "/nodate.json")).toBeUndefined();
  });
});

describe("two remote folders claiming one local name", () => {
  it("never merges two different papers that share a citekey", async () => {
    const provider = new FakeRemoteProvider();
    // Device B already synced its paper wang2021deep.
    const deviceB = new MemoryFileSystem();
    deviceB.seed("/lib/wang2021deep/metadata.yaml", metadata("wang2021deep", "Deep B"));
    deviceB.seed("/lib/wang2021deep/paper.pdf", "%PDF-B");
    await syncDevice(deviceB, provider, buildLibraryFolderNames([["wang2021deep", "Deep B"]]));

    // Device A, unaware of it, adds a different paper whose key came out the same.
    const deviceA = new MemoryFileSystem();
    deviceA.seed("/lib/wang2021deep/metadata.yaml", metadata("wang2021deep", "Deep A"));
    deviceA.seed("/lib/wang2021deep/paper.pdf", "%PDF-A");
    const root = (await provider.resolveRoot("library")).id;
    const folderA = await provider.createFolder(root, "Deep A");
    await provider.upload(folderA.id, "metadata.yaml", Buffer.from(metadata("wang2021deep", "Deep A")));
    await provider.upload(folderA.id, "paper.pdf", Buffer.from("%PDF-A"));

    await syncDevice(deviceB, provider, buildLibraryFolderNames([["wang2021deep", "Deep B"]]));
    // B's own paper is untouched; A's arrives beside it instead of over it.
    expect(deviceB.text("/lib/wang2021deep/paper.pdf")).toBe("%PDF-B");
    expect(deviceB.text("/lib/Deep A/paper.pdf")).toBe("%PDF-A");
  });

  it("keeps two Drive folders with the same display name apart", async () => {
    const provider = new FakeRemoteProvider();
    const root = (await provider.resolveRoot("library")).id;
    for (const body of ["one", "two"]) {
      const folder = await provider.createFolder(root, "Same Title");
      await provider.upload(folder.id, "notes.txt", Buffer.from(body));
    }
    const device = new MemoryFileSystem();
    await syncDevice(device, provider, buildLibraryFolderNames([]));
    const notes = device.paths().filter((p) => p.endsWith("/notes.txt")).map((p) => device.text(p)).sort();
    expect(notes).toEqual(["one", "two"]);
  });
});

// A provider whose root folders have other ids, as another Google account or OAuth client would.
function anotherAccount(inner: FakeRemoteProvider): RemoteProvider {
  const unwrap = (id: string): string => (id.startsWith("acct2:") ? id.slice(6) : id);
  return {
    id: inner.id,
    displayName: inner.displayName,
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
    isConnected: () => inner.isConnected(),
    resolveRoot: async (ns) => { const root = await inner.resolveRoot(ns); return { ...root, id: `acct2:${root.id}` }; },
    list: (id) => inner.list(unwrap(id)),
    createFolder: (parent, name) => inner.createFolder(unwrap(parent), name),
    upload: (parent, name, content, existing) => inner.upload(unwrap(parent), name, content, existing),
    download: (id) => inner.download(id),
    remove: (id) => inner.remove(id),
    move: (id, parent, name) => inner.move(id, unwrap(parent), name),
  };
}

describe("a manifest built against another remote", () => {
  async function seededDevice(provider: FakeRemoteProvider): Promise<MemoryFileSystem> {
    const fs = new MemoryFileSystem();
    fs.seed("/lib/p1/metadata.yaml", metadata("p1", "P1"));
    fs.seed("/lib/p1/paper.pdf", "%PDF-1");
    fs.seed("/app/p1/data.json", "{}");
    await syncDevice(fs, provider);
    return fs;
  }

  it("does not delete the local library when the account or OAuth client changes", async () => {
    const device = await seededDevice(new FakeRemoteProvider());
    // Same local folder and manifest, but another Drive: empty, with root folders of its own.
    const other = anotherAccount(new FakeRemoteProvider());
    const manifest = await SyncManifest.load(device, "/m.json", "fake");
    const result = await new SyncEngine({ provider: other, fs: device, manifest, roots: { library: "/lib", appdata: "/app" } }).run();
    expect(device.has("/lib/p1/paper.pdf")).toBe(true);
    expect(device.has("/app/p1/data.json")).toBe(true);
    expect(result.namespaces.every((ns) => ns.rebased === true && ns.deletedLocal === 0)).toBe(true);
    expect(result.namespaces.find((ns) => ns.namespace === "library")!.uploaded).toBe(2);
  });

  it("rebases an old manifest (no recorded root) that meets an empty remote", async () => {
    const provider = new FakeRemoteProvider();
    const device = await seededDevice(provider);
    const raw = JSON.parse(device.text("/m.json"));
    delete raw.roots;
    device.seed("/m.json", JSON.stringify(raw));
    const fresh = new FakeRemoteProvider();
    await syncDevice(device, fresh);
    expect(device.has("/lib/p1/paper.pdf")).toBe(true);
  });

  it("still applies a real deletion made on the same remote", async () => {
    const provider = new FakeRemoteProvider();
    const device = await seededDevice(provider);
    for (const ns of ["library", "appdata"] as const) {
      const rootId = (await provider.resolveRoot(ns)).id;
      for (const folder of await provider.list(rootId)) { await provider.remove(folder.id); }
    }
    await syncDevice(device, provider);
    expect(device.has("/lib/p1/paper.pdf")).toBe(false);
  });
});
