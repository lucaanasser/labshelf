/** The terminal's view of a library on disk: the resolved root with its layout, collection folders and the
 * filesystem checks that create or recognise a library. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { libraryLayout, type LibraryLayout } from "@labshelf/core";

export class LibraryRoot {
  readonly root: string;
  readonly layout: LibraryLayout<string>;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.layout = libraryLayout(this.root, path.join);
  }

  /** Absolute folder of a collection from its path relative to papers/ ("" is the root). */
  collectionDir(rel: string): string {
    const papers = this.layout.papersRoot();
    return rel ? path.join(papers, ...rel.split("/")) : papers;
  }

  /** The collection path (relative to papers/, "/"-separated) of an absolute folder; "" for papers/ itself. */
  relativeCollection(absDir: string): string {
    const rel = path.relative(this.layout.papersRoot(), absDir);
    return rel.split(path.sep).filter(Boolean).join("/");
  }
}

/** Creates the folders a library needs. */
export async function ensureLibraryStructure(library: LibraryRoot): Promise<void> {
  for (const dir of library.layout.requiredDirs()) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/** Whether a folder looks like a LabShelf library (it has one of the marker folders). */
export async function looksLikeLibrary(root: string): Promise<boolean> {
  for (const dir of libraryLayout(root, path.join).markerDirs()) {
    try {
      if ((await fs.stat(dir)).isDirectory()) { return true; }
    } catch {
      // keep looking
    }
  }
  return false;
}
