/**
 * Read access to the per-paper sidecars (.research/papers/<id>/data.json) the readers write: annotations, theme and
 * reading position. The format and the store come from @labshelf/core, the same code the VS Code and browser readers
 * use, so the terminal never writes a sidecar the other apps cannot read.
 */
import { promises as fs } from "node:fs";

import { PaperDataStore, type PaperData, type SidecarPort } from "@labshelf/core";
import { writeFileAtomic } from "@labshelf/core/node";

import { LibraryRoot } from "./libraryRoot.js";

/** SidecarPort over the library's .research/papers folder. */
export class NodeSidecarPort implements SidecarPort {
  constructor(private readonly paths: LibraryRoot) {}

  async read(paperId: string): Promise<string | null> {
    try {
      return await fs.readFile(this.paths.layout.paperDataPath(paperId), "utf8");
    } catch {
      return null;
    }
  }

  async write(paperId: string, text: string): Promise<void> {
    await writeFileAtomic(this.paths.layout.paperDataPath(paperId), text, this.paths.layout.tmpDir());
  }
}

/** Cached sidecar reads, invalidated by mtime so edits from VS Code or a sync show up. */
export class SidecarReader {
  private readonly store: PaperDataStore;
  private readonly cache = new Map<string, { mtimeMs: number; data: PaperData }>();

  constructor(private readonly paths: LibraryRoot) {
    this.store = new PaperDataStore(new NodeSidecarPort(paths));
  }

  /**
   * @returns the paper's sidecar (empty when it has none)
   */
  async load(paperId: string): Promise<PaperData> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await fs.stat(this.paths.layout.paperDataPath(paperId))).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    const cached = this.cache.get(paperId);
    if (cached && cached.mtimeMs === mtimeMs) { return cached.data; }
    const data = await this.store.load(paperId);
    data.annotations.sort((a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt));
    this.cache.set(paperId, { mtimeMs, data });
    return data;
  }

  /**
   * Annotation text of every paper that has a sidecar, for the library search.
   * @returns paperId → concatenated annotation text
   */
  async annotationIndex(paperIds: Iterable<string>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of paperIds) {
      const data = await this.load(id);
      if (data.annotations.length) {
        out.set(id, data.annotations.map((a) => a.content).join("\n"));
      }
    }
    return out;
  }
}
