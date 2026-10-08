/**
 * Read access to the per-paper sidecars (.research/papers/<id>/data.json) the readers write: annotations, theme and
 * reading position. The format and the store come from @labshelf/reader, the same code the VS Code and browser readers
 * use, so the terminal never writes a sidecar the other apps cannot read.
 *
 * @depends @labshelf/reader (PaperDataStore, SidecarPort), platform/nodeFileSystem, library/libraryPaths
 * @dependents app/context, ui/app (preview Notes tab), cli show/notes
 */
import { promises as fs } from "node:fs";

import { PaperDataStore, type PaperData, type SidecarPort } from "@labshelf/reader";

import { writeFileAtomic } from "../platform/nodeFileSystem.js";
import { LibraryPaths } from "./libraryPaths.js";

/** SidecarPort over the library's .research/papers folder. */
export class NodeSidecarPort implements SidecarPort {
  constructor(private readonly paths: LibraryPaths) {}

  async read(paperId: string): Promise<string | null> {
    try {
      return await fs.readFile(this.paths.paperDataPath(paperId), "utf8");
    } catch {
      return null;
    }
  }

  async write(paperId: string, text: string): Promise<void> {
    await writeFileAtomic(this.paths.paperDataPath(paperId), text, this.paths.tmpDir());
  }
}

/** Cached sidecar reads, invalidated by mtime so edits from VS Code or a sync show up. */
export class SidecarReader {
  private readonly store: PaperDataStore;
  private readonly cache = new Map<string, { mtimeMs: number; data: PaperData }>();

  constructor(private readonly paths: LibraryPaths) {
    this.store = new PaperDataStore(new NodeSidecarPort(paths));
  }

  /**
   * @usedBy ui/app, cli
   * @returns the paper's sidecar (empty when it has none)
   */
  async load(paperId: string): Promise<PaperData> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await fs.stat(this.paths.paperDataPath(paperId))).mtimeMs;
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
   * @usedBy app/context
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
