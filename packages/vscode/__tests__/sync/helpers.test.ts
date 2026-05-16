import { conflictPath, isoDate } from "../../src/sync/conflictName.js";
import { sha256Hex } from "../../src/sync/contentHash.js";
import { splitPath, RemotePathResolver } from "../../src/sync/remotePathResolver.js";
import { FakeRemoteProvider } from "./fakes.js";

describe("conflictName", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-16T23:00:00.000Z"))).toBe("2026-05-16");
  });

  it("preserves the extension when renaming", () => {
    expect(conflictPath("papers/a/paper.pdf", new Date("2026-05-16T00:00:00Z")))
      .toBe("papers/a/paper (conflito 2026-05-16).pdf");
  });

  it("handles paths without an extension", () => {
    expect(conflictPath("README", new Date("2026-05-16T00:00:00Z")))
      .toBe("README (conflito 2026-05-16)");
  });
});

describe("contentHash", () => {
  it("produces a stable SHA-256 hex digest", () => {
    expect(sha256Hex(Buffer.from("abc", "utf8"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("splitPath", () => {
  it("splits nested paths", () => {
    expect(splitPath("a/b/c.pdf")).toEqual({ dir: "a/b", name: "c.pdf" });
  });

  it("handles a bare filename", () => {
    expect(splitPath("c.pdf")).toEqual({ dir: "", name: "c.pdf" });
  });
});

describe("RemotePathResolver", () => {
  it("creates intermediate folders and caches their ids", async () => {
    const provider = new FakeRemoteProvider();
    const root = await provider.resolveRoot("library");
    const resolver = new RemotePathResolver(provider, root.id);

    const first = await resolver.ensureFolder("papers/a");
    const again = await resolver.ensureFolder("papers/a");
    expect(first).toBe(again);

    const parent = await resolver.parentOf("papers/a/paper.pdf");
    expect(parent).toBe(first);
  });

  it("reuses a registered folder id without creating one", async () => {
    const provider = new FakeRemoteProvider();
    const root = await provider.resolveRoot("library");
    const resolver = new RemotePathResolver(provider, root.id);
    resolver.register("papers", "known-id");
    expect(await resolver.ensureFolder("papers")).toBe("known-id");
  });
});
