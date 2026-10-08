import * as path from "node:path";

import {
  APPDATA_DIR, APP_LOG_FILE, BIB_FILE, BROWSER_SYNC_ROOTS, INDEX_FILE, METADATA_FILE, PAPERS_DIR, PDF_FILE,
  RESEARCH_DIR, SIDECAR_FILE, SYNC_PROVIDER_ID, TERMINAL_LOG_FILE,
  joinWith, libraryLayout, paperFiles, syncRoots,
} from "@labshelf/core";

describe("layout constants", () => {
  it("pin the on-disk names", () => {
    expect([PAPERS_DIR, RESEARCH_DIR, APPDATA_DIR]).toEqual(["papers", ".research", "appdata"]);
    expect([PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE]).toEqual(["paper.pdf", "metadata.yaml", "bib.bib", "data.json"]);
    expect([INDEX_FILE, APP_LOG_FILE, TERMINAL_LOG_FILE]).toEqual(["index.sqlite", "app.log", "terminal.log"]);
    expect(SYNC_PROVIDER_ID).toBe("google-drive");
  });
});

describe.each([
  ["posix", path.posix.join, "/data/lib"],
  ["win32", path.win32.join, "C:\\data\\lib"],
])("libraryLayout with path.%s.join", (_name, join, root) => {
  const l = libraryLayout(root, join);
  const at = (...parts: string[]) => join(root, ...parts);

  it("derives papers/ and .research/ locations from the root", () => {
    expect(l.root).toBe(root);
    expect(l.papersRoot()).toBe(at("papers"));
    expect(l.researchRoot()).toBe(at(".research"));
    expect(l.paperDataRoot()).toBe(at(".research", "papers"));
    expect(l.paperDataDir("p1")).toBe(at(".research", "papers", "p1"));
    expect(l.paperDataPath("p1")).toBe(at(".research", "papers", "p1", "data.json"));
    expect(l.logsDir()).toBe(at(".research", "logs"));
    expect(l.appLogPath()).toBe(at(".research", "logs", "app.log"));
    expect(l.terminalLogPath()).toBe(at(".research", "logs", "terminal.log"));
    expect(l.indexPath()).toBe(at(".research", "index.sqlite"));
    expect(l.tmpDir()).toBe(at(".research", "tmp"));
  });

  it("names the sync files after the provider, google-drive by default", () => {
    const sync = at(".research", "sync");
    expect(l.syncDir()).toBe(sync);
    expect(l.manifestPath()).toBe(join(sync, "google-drive.state.json"));
    expect(l.lockPath()).toBe(join(sync, "google-drive.lock"));
    expect(l.lastRunPath()).toBe(join(sync, "google-drive.last.json"));
    expect(l.manifestPath("dropbox")).toBe(join(sync, "dropbox.state.json"));
    expect(l.lockPath("dropbox")).toBe(join(sync, "dropbox.lock"));
    expect(l.lastRunPath("dropbox")).toBe(join(sync, "dropbox.last.json"));
  });

  it("keeps the temp folder outside both synced roots", () => {
    const sep = join("a", "b")[1];
    expect(l.tmpDir().startsWith(l.papersRoot() + sep)).toBe(false);
    expect(l.tmpDir().startsWith(l.paperDataRoot() + sep)).toBe(false);
  });

  it("lists the folders to create and the folders that mark a library", () => {
    expect(l.requiredDirs()).toEqual([
      at(".research"), at(".research", "logs"), at(".research", "papers"), at(".research", "sync"), at("papers"),
    ]);
    expect(l.markerDirs()).toEqual([at("papers"), at(".research")]);
  });
});

describe("joinWith", () => {
  it("joins with the given separator and skips empty parts", () => {
    expect(joinWith("/")("a", "b", "c")).toBe("a/b/c");
    expect(joinWith("\\")("a", "", "c")).toBe("a\\c");
    expect(joinWith("/")("", "papers")).toBe("papers");
  });

  it("yields relative keys on an empty root", () => {
    const l = libraryLayout("", joinWith("/"));
    expect(l.papersRoot()).toBe("papers");
    expect(l.paperDataPath("p1")).toBe(".research/papers/p1/data.json");
    expect(l.lockPath()).toBe(".research/sync/google-drive.lock");
  });
});

describe("a generic join", () => {
  it("works over any path type", () => {
    type Uri = { parts: string[] };
    const join = (base: Uri, ...segments: string[]): Uri => ({ parts: [...base.parts, ...segments] });
    const l = libraryLayout<Uri>({ parts: ["lib"] }, join);
    expect(l.paperDataPath("p1").parts).toEqual(["lib", ".research", "papers", "p1", "data.json"]);
    expect(l.requiredDirs().map((u) => u.parts.join("/"))).toContain("lib/.research/sync");
  });
});

describe("paperFiles / syncRoots", () => {
  it("names the files inside a paper folder", () => {
    expect(paperFiles("/lib/papers/p1", path.posix.join)).toEqual({
      pdf: "/lib/papers/p1/paper.pdf",
      metadata: "/lib/papers/p1/metadata.yaml",
      bib: "/lib/papers/p1/bib.bib",
    });
  });

  it("maps the synced roots", () => {
    expect(syncRoots(libraryLayout("/lib", path.posix.join))).toEqual({ library: "/lib/papers", appdata: "/lib/.research/papers" });
    expect(BROWSER_SYNC_ROOTS).toEqual({ library: "papers", appdata: "appdata" });
  });
});
