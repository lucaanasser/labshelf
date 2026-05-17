import { SyncManifest } from "../../src/sync/core/syncManifest.js";
import { MemoryFileSystem } from "./fakes.js";

describe("SyncManifest", () => {
  it("starts empty when no file exists", async () => {
    const fs = new MemoryFileSystem();
    const m = await SyncManifest.load(fs, "/state.json", "fake");
    expect(m.paths("library")).toEqual([]);
    expect(m.get("library", "a.pdf")).toBeUndefined();
  });

  it("sets, reads, and deletes entries", async () => {
    const m = await SyncManifest.load(new MemoryFileSystem(), "/s.json", "fake");
    m.set("library", "a.pdf", {
      remoteId: "r1",
      contentHash: "h1",
      modifiedTime: "t1",
    });
    expect(m.get("library", "a.pdf")).toEqual({
      remoteId: "r1",
      contentHash: "h1",
      modifiedTime: "t1",
    });
    m.delete("library", "a.pdf");
    expect(m.get("library", "a.pdf")).toBeUndefined();
  });

  it("round-trips through save and load", async () => {
    const fs = new MemoryFileSystem();
    const first = await SyncManifest.load(fs, "/s.json", "fake");
    first.set("library", "papers/x/paper.pdf", {
      remoteId: "r1",
      contentHash: "h1",
      modifiedTime: "t1",
    });
    first.set("appdata", "papers/x/data.json", {
      remoteId: "r2",
      contentHash: "h2",
      modifiedTime: "t2",
    });
    await first.save();

    const reloaded = await SyncManifest.load(fs, "/s.json", "fake");
    expect(reloaded.get("library", "papers/x/paper.pdf")).toEqual({
      remoteId: "r1",
      contentHash: "h1",
      modifiedTime: "t1",
    });
    expect(reloaded.get("appdata", "papers/x/data.json")?.remoteId).toBe("r2");
  });

  it("falls back to empty on corrupt manifest JSON", async () => {
    const fs = new MemoryFileSystem();
    fs.seed("/s.json", "{ not json");
    const m = await SyncManifest.load(fs, "/s.json", "fake");
    expect(m.paths("library")).toEqual([]);
  });

  it("snapshot is an independent copy", async () => {
    const m = await SyncManifest.load(new MemoryFileSystem(), "/s.json", "fake");
    m.set("library", "a", { remoteId: "r", contentHash: "h", modifiedTime: "t" });
    const snap = m.snapshot();
    m.delete("library", "a");
    expect(snap.namespaces.library["a"]).toBeDefined();
  });
});
