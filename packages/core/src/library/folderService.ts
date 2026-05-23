/**
 * Platform-agnostic helpers for re-indexing PaperRecords when a collection
 * folder is renamed, moved, or deleted. Filesystem-level operations (mkdir,
 * rename, rmdir) stay in the consuming package because their APIs diverge
 * (vscode.workspace.fs vs IndexedDbFileSystem); only the record bookkeeping is
 * shared here.
 *
 * @depends interfaces/database (subset), types/paperRecord
 * @dependents @labshelf/vscode paperService, @labshelf/browser folderController
 */
import type { PaperRecord } from "../types/paperRecord.js";

/**
 * Minimal subset of {@link IResearchDatabase} that FolderService needs. Lets
 * the browser pass a tiny adapter over its IDB-backed paperRecordStore without
 * implementing the full database surface.
 */
export interface IPaperRecordIndex {
  listPapers(): Promise<PaperRecord[]>;
  upsertPaper(paper: PaperRecord): Promise<void>;
  deletePaper(id: string): Promise<void>;
}

export interface FolderRelocation {
  /** Paper records whose stored path was rewritten to point under newDir. */
  updated: PaperRecord[];
}

export interface FolderRemoval {
  /** Ids of paper records removed from the index. */
  removedIds: string[];
}

/**
 * Returns true if `paperPath` lies at or beneath `dirPath`, honoring the
 * given separator. Uses prefix matching so the same call works for both
 * POSIX (`/`) and Windows (`\`) layouts.
 */
export function isUnderDir(paperPath: string, dirPath: string, sep: string): boolean {
  return paperPath === dirPath || paperPath.startsWith(dirPath + sep);
}

/**
 * Rewrites a single path so segments under `oldDir` are re-rooted under
 * `newDir`. Returns the input unchanged if it does not lie under `oldDir`.
 */
export function rewritePath(paperPath: string, oldDir: string, newDir: string, sep: string): string {
  if (paperPath === oldDir) return newDir;
  if (!paperPath.startsWith(oldDir + sep)) return paperPath;
  const tail = paperPath.slice(oldDir.length + sep.length);
  return newDir + sep + tail;
}

/**
 * Reusable folder bookkeeping over an IPaperRecordIndex. Callers stay
 * responsible for the actual directory move/delete and for emitting any
 * platform-specific events.
 *
 * @usedBy VSCode paperService.relocate/remove; browser folderController
 */
export class FolderService {
  constructor(
    private readonly papers: IPaperRecordIndex,
    private readonly sep: string = "/",
  ) {}

  /** Upserts every paper under `oldDir` with its path rewritten to `newDir`. */
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<FolderRelocation> {
    const all = await this.papers.listPapers();
    const updated: PaperRecord[] = [];
    for (const paper of all) {
      if (!isUnderDir(paper.path, oldDir, this.sep)) continue;
      const next: PaperRecord = { ...paper, path: rewritePath(paper.path, oldDir, newDir, this.sep) };
      await this.papers.upsertPaper(next);
      updated.push(next);
    }
    return { updated };
  }

  /** Deletes every paper record whose stored path lies under `dirPath`. */
  async removePapersUnder(dirPath: string): Promise<FolderRemoval> {
    const all = await this.papers.listPapers();
    const removedIds: string[] = [];
    for (const paper of all) {
      if (!isUnderDir(paper.path, dirPath, this.sep)) continue;
      await this.papers.deletePaper(paper.id);
      removedIds.push(paper.id);
    }
    return { removedIds };
  }
}
