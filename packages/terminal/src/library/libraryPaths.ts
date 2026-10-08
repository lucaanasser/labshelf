/**
 * Every well-known path of a LabShelf library, from its root folder. The layout is the one the VS Code extension
 * creates (storage/paths/libraryPaths.ts there): papers/ holds the visible paper folders, .research/ the sidecars,
 * the sync state and the logs.
 *
 *   <root>/papers/<collection…>/<paperId>/{metadata.yaml, bib.bib, paper.pdf}
 *   <root>/.research/papers/<paperId>/data.json          annotations, theme, reading position
 *   <root>/.research/sync/google-drive.state.json         sync manifest (shared with VS Code)
 *   <root>/.research/sync/google-drive.lock               cross-app sync lock
 *   <root>/.research/sync/google-drive.last.json          last successful sync, by any app
 *
 * @depends none
 * @dependents app/context, library/*, sync/*
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const SYNC_PROVIDER_ID = "google-drive";
export const PDF_NAME = "paper.pdf";
export const METADATA_NAME = "metadata.yaml";
export const BIB_NAME = "bib.bib";

export class LibraryPaths {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  papersRoot(): string { return path.join(this.root, "papers"); }
  researchRoot(): string { return path.join(this.root, ".research"); }
  paperDataRoot(): string { return path.join(this.root, ".research", "papers"); }
  paperDataPath(paperId: string): string { return path.join(this.paperDataRoot(), paperId, "data.json"); }
  syncDir(): string { return path.join(this.root, ".research", "sync"); }
  manifestPath(provider = SYNC_PROVIDER_ID): string { return path.join(this.syncDir(), `${provider}.state.json`); }
  lockPath(provider = SYNC_PROVIDER_ID): string { return path.join(this.syncDir(), `${provider}.lock`); }
  lastRunPath(provider = SYNC_PROVIDER_ID): string { return path.join(this.syncDir(), `${provider}.last.json`); }
  logsDir(): string { return path.join(this.root, ".research", "logs"); }
  terminalLogPath(): string { return path.join(this.logsDir(), "terminal.log"); }
  /** Scratch space for atomic writes: same volume as the library, outside both synced roots. */
  tmpDir(): string { return path.join(this.root, ".research", "tmp"); }

  /**
   * Absolute folder of a collection from its path relative to papers/ ("" is the root).
   * @usedBy library/paperService, ui
   * @returns the absolute path
   */
  collectionDir(rel: string): string {
    return rel ? path.join(this.papersRoot(), ...rel.split("/")) : this.papersRoot();
  }

  /**
   * The collection path (relative to papers/, "/"-separated) of an absolute folder.
   * @usedBy library/libraryScanner
   * @returns the relative path, "" for papers/ itself
   */
  relativeCollection(absDir: string): string {
    const rel = path.relative(this.papersRoot(), absDir);
    return rel.split(path.sep).filter(Boolean).join("/");
  }
}

/**
 * Creates the folders a library needs (the same set the VS Code extension creates).
 * @usedBy cli init, ui setup, app/context
 * @returns void
 */
export async function ensureLibraryStructure(paths: LibraryPaths): Promise<void> {
  for (const dir of [paths.papersRoot(), paths.paperDataRoot(), paths.syncDir(), paths.logsDir()]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Whether a folder looks like a LabShelf library (it has papers/ or .research/).
 * @usedBy main, cli doctor
 * @returns true when it does
 */
export async function looksLikeLibrary(root: string): Promise<boolean> {
  for (const child of ["papers", ".research"]) {
    try {
      if ((await fs.stat(path.join(root, child))).isDirectory()) { return true; }
    } catch {
      // keep looking
    }
  }
  return false;
}
