import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  BIB_NAME,
  LibraryPaths,
  METADATA_NAME,
  PDF_NAME,
  SYNC_PROVIDER_ID,
  ensureLibraryStructure,
  looksLikeLibrary,
} from "../../src/library/libraryPaths";
import { cleanupTempDirs, makeTempDir, pathExists } from "../fixtures/library";

afterEach(cleanupTempDirs);

describe("LibraryPaths layout (same as the VS Code extension)", () => {
  const root = path.resolve("/data/lib");
  const paths = new LibraryPaths(root);

  it("keeps the well-known file names", () => {
    expect(PDF_NAME).toBe("paper.pdf");
    expect(METADATA_NAME).toBe("metadata.yaml");
    expect(BIB_NAME).toBe("bib.bib");
    expect(SYNC_PROVIDER_ID).toBe("google-drive");
  });

  it("derives papers/ and .research/ locations from the root", () => {
    expect(paths.papersRoot()).toBe(path.join(root, "papers"));
    expect(paths.researchRoot()).toBe(path.join(root, ".research"));
    expect(paths.paperDataRoot()).toBe(path.join(root, ".research", "papers"));
    expect(paths.paperDataPath("vaswani2017attention")).toBe(
      path.join(root, ".research", "papers", "vaswani2017attention", "data.json"),
    );
    expect(paths.logsDir()).toBe(path.join(root, ".research", "logs"));
    expect(paths.terminalLogPath()).toBe(path.join(root, ".research", "logs", "terminal.log"));
    expect(paths.tmpDir()).toBe(path.join(root, ".research", "tmp"));
  });

  it("names the sync files after the provider, google-drive by default", () => {
    const sync = path.join(root, ".research", "sync");
    expect(paths.syncDir()).toBe(sync);
    expect(paths.manifestPath()).toBe(path.join(sync, "google-drive.state.json"));
    expect(paths.lockPath()).toBe(path.join(sync, "google-drive.lock"));
    expect(paths.lastRunPath()).toBe(path.join(sync, "google-drive.last.json"));
    expect(paths.manifestPath("dropbox")).toBe(path.join(sync, "dropbox.state.json"));
    expect(paths.lockPath("dropbox")).toBe(path.join(sync, "dropbox.lock"));
    expect(paths.lastRunPath("dropbox")).toBe(path.join(sync, "dropbox.last.json"));
  });

  it("resolves a relative root to an absolute one", () => {
    expect(new LibraryPaths("some/relative/lib").root).toBe(path.resolve("some/relative/lib"));
    expect(path.isAbsolute(new LibraryPaths("rel").papersRoot())).toBe(true);
  });

  it("keeps the temp folder outside papers/ and .research/papers (the two synced roots)", () => {
    expect(paths.tmpDir().startsWith(paths.papersRoot() + path.sep)).toBe(false);
    expect(paths.tmpDir().startsWith(paths.paperDataRoot() + path.sep)).toBe(false);
  });
});

describe("collectionDir / relativeCollection", () => {
  const paths = new LibraryPaths(path.resolve("/data/lib"));

  it("maps the empty path to papers/ and nested paths below it", () => {
    expect(paths.collectionDir("")).toBe(paths.papersRoot());
    expect(paths.collectionDir("ML")).toBe(path.join(paths.papersRoot(), "ML"));
    expect(paths.collectionDir("ML/Vision/Detection")).toBe(path.join(paths.papersRoot(), "ML", "Vision", "Detection"));
  });

  it("returns '' for papers/ itself and '/'-separated paths otherwise", () => {
    expect(paths.relativeCollection(paths.papersRoot())).toBe("");
    expect(paths.relativeCollection(path.join(paths.papersRoot(), "ML", "Vision"))).toBe("ML/Vision");
  });

  it.each(["", "ML", "ML/Vision", "Bio/Cells and Tissue/2024", "Ünï cödé/ß"])("round-trips %j", (rel) => {
    expect(paths.relativeCollection(paths.collectionDir(rel))).toBe(rel);
  });
});

describe("ensureLibraryStructure", () => {
  it("creates papers/, .research/papers, .research/sync and .research/logs", async () => {
    const root = await makeTempDir();
    const paths = new LibraryPaths(path.join(root, "fresh", "lib"));
    await ensureLibraryStructure(paths);
    for (const dir of [paths.papersRoot(), paths.paperDataRoot(), paths.syncDir(), paths.logsDir()]) {
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    }
  });

  it("is idempotent and leaves existing content alone", async () => {
    const root = await makeTempDir();
    const paths = new LibraryPaths(root);
    await ensureLibraryStructure(paths);
    const keep = path.join(paths.papersRoot(), "ML", "p1");
    await fs.mkdir(keep, { recursive: true });
    await fs.writeFile(path.join(keep, "metadata.yaml"), "title: x\n");

    await ensureLibraryStructure(paths);

    expect(await fs.readFile(path.join(keep, "metadata.yaml"), "utf8")).toBe("title: x\n");
  });
});

describe("looksLikeLibrary", () => {
  it("is false for an empty folder and for a folder that does not exist", async () => {
    const root = await makeTempDir();
    expect(await looksLikeLibrary(root)).toBe(false);
    expect(await looksLikeLibrary(path.join(root, "missing"))).toBe(false);
  });

  it("is true when papers/ exists", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "papers"));
    expect(await looksLikeLibrary(root)).toBe(true);
  });

  it("is true when only .research/ exists", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, ".research"));
    expect(await looksLikeLibrary(root)).toBe(true);
  });

  it("ignores a plain file called papers", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "papers"), "not a folder");
    expect(await looksLikeLibrary(root)).toBe(false);
  });

  it("recognises a library created by ensureLibraryStructure", async () => {
    const root = await makeTempDir();
    expect(await pathExists(path.join(root, "papers"))).toBe(false);
    await ensureLibraryStructure(new LibraryPaths(root));
    expect(await looksLikeLibrary(root)).toBe(true);
  });
});
