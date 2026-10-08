/** Applies the core library mutations to the IndexedDB library and keeps the paper-record cache in step with the files. */
import {
  BibTeXService, FolderService, createFolder, movePapers, posixPathOps, readPaperOnDisk, renameFolder, setPaperStatus,
  trashFolder, trashPapers, writePaperRecord, PAPERS_DIR,
} from "@labshelf/core";
import type {
  BatchOutcome, FieldsBatchOutcome, ILogger, IPaperRecordIndex, MoveOutcome, MutationContext, PaperRecord, PaperRef, PaperStatus,
} from "@labshelf/core";
import { IndexedDbFileSystem } from "./indexedDbFileSystem";
import { deleteRecord, listAllRecords, upsertRecord } from "./paperRecordStore";

export interface LibraryMutations {
  setStatus(papers: PaperRef[], status: PaperStatus): Promise<FieldsBatchOutcome>;
  /** Rewrites the metadata files of a paper whose PDF was just written, keeping the status on disk. */
  recordPdfAttached(record: PaperRecord): Promise<PaperRecord>;
  movePapers(papers: PaperRef[], targetDir: string): Promise<MoveOutcome>;
  trashPapers(papers: PaperRef[]): Promise<BatchOutcome>;
  createFolder(parentDir: string, name: string): Promise<string>;
  renameFolder(dir: string, name: string): Promise<string>;
  trashFolder(dir: string): Promise<void>;
}

const recordIndex: IPaperRecordIndex = {
  listPapers: () => listAllRecords(),
  upsertPaper: (paper) => upsertRecord(paper, paper.path),
  deletePaper: (id) => deleteRecord(id),
};

/** The mutations run on disk first and the cache follows, so a failed write never leaves the cache ahead of the files. */
export function createLibraryMutations(logger: ILogger): LibraryMutations {
  const fs = new IndexedDbFileSystem();
  const ctx: MutationContext = { fs, paths: posixPathOps, artifacts: new BibTeXService(fs), logger, papersRoot: PAPERS_DIR };
  const folders = new FolderService(recordIndex, "/");

  return {
    async setStatus(papers, status) {
      const outcome = await setPaperStatus(ctx, papers, status);
      for (const record of outcome.records) { await upsertRecord(record, record.path); }
      return outcome;
    },
    async recordPdfAttached(record) {
      const current = (await readPaperOnDisk(ctx, record.path)) ?? record;
      const written = await writePaperRecord(ctx, { ...current, hasPdf: true }, { ownsStatus: false });
      await upsertRecord(written, written.path);
      return written;
    },
    async movePapers(papers, targetDir) {
      const outcome = await movePapers(ctx, papers, targetDir);
      for (const move of outcome.moves) { await folders.relocatePapersUnder(move.from, move.to); }
      return outcome;
    },
    async trashPapers(papers) {
      const outcome = await trashPapers(ctx, papers);
      for (const id of outcome.done) { await deleteRecord(id); }
      return outcome;
    },
    createFolder: (parentDir, name) => createFolder(ctx, parentDir, name),
    async renameFolder(dir, name) {
      const to = await renameFolder(ctx, dir, name);
      if (to !== dir) { await folders.relocatePapersUnder(dir, to); }
      return to;
    },
    async trashFolder(dir) {
      await trashFolder(ctx, dir);
      await folders.removePapersUnder(dir);
    },
  };
}
