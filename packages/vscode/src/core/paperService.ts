/** Changes and reads papers already in the library: disk first through the core mutations, then the index and its events. */
import * as path from "node:path";
import * as vscode from "vscode";

import {
  EVENTS,
  FolderService,
  editPaperTags,
  movePapers,
  paperFiles,
  trashPapers,
  updatePaperFields,
  withResolvedMetadata,
  writePaperRecord,
} from "@labshelf/core";
import type {
  BatchOutcome,
  BibTeXService,
  EventBus,
  IResearchDatabase,
  MoveOutcome,
  MutationContext,
  PaperFieldsPatch,
  PaperRecord,
  PaperRef,
  PdfParse,
  RecordMetadata,
} from "@labshelf/core";

export class PaperService {
  constructor(
    private readonly ctx: MutationContext,
    private readonly database: IResearchDatabase,
    private readonly eventBus: EventBus,
    private readonly bibTeXService: BibTeXService,
    private readonly parse: PdfParse,
  ) {}

  listPapers(): Promise<PaperRecord[]> {
    return this.database.listPapers();
  }

  async findPaper(paperId: string): Promise<PaperRecord | undefined> {
    return (await this.database.listPapers()).find((paper) => paper.id === paperId);
  }

  /** @returns every paper no registry confirmed, worth re-resolving or filling in by hand */
  async listUnresolvedPapers(): Promise<PaperRecord[]> {
    return (await this.database.listPapers()).filter((paper) => !paper.doi);
  }

  /** @returns the paper's paper.pdf, or null when the id is unknown or the paper has no PDF */
  async resolvePdfUri(paperId: string): Promise<vscode.Uri | null> {
    const paper = await this.findPaper(paperId);
    if (!paper || paper.hasPdf === false || !(await this.pdfExists(paper))) {
      return null;
    }
    return vscode.Uri.file(paperFiles(paper.path, path.join).pdf);
  }

  // Asked at action time rather than trusting the indexed flag. FileType is a bit flag and the indexer counts a
  // symlinked PDF (File|SymbolicLink) as present, so this does too; otherwise reconcilePdf would undo the indexer.
  async pdfExists(paper: PaperRecord): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(paperFiles(paper.path, path.join).pdf));
      return (stat.type & vscode.FileType.File) !== 0;
    } catch {
      return false;
    }
  }

  /**
   * Corrects a stale hasPdf flag in the index; hasPdf is derived, so metadata.yaml is never touched.
   * @returns the current record and its real hasPdf, or undefined when the paper is unknown
   */
  async reconcilePdf(paperId: string): Promise<{ paper: PaperRecord; hasPdf: boolean } | undefined> {
    const current = await this.findPaper(paperId);
    if (!current) { return undefined; }
    const hasPdf = await this.pdfExists(current);
    if (current.hasPdf === hasPdf) { return { paper: current, hasPdf }; }
    const updated: PaperRecord = { ...current, hasPdf };
    await this.putUpdated(updated);
    return { paper: updated, hasPdf };
  }

  /** @returns the BibTeX entry as written to the paper's folder, without the local `file` line */
  bibtexFor(paper: PaperRecord): string {
    return this.bibTeXService.generateBibTeX(paper, { includeFile: false });
  }

  updatePaperStatus(paperId: string, status: PaperRecord["status"]): Promise<PaperRecord | undefined> {
    return this.updatePaperFields(paperId, { status });
  }

  /** @returns the paper after the patch, or undefined when it is unknown or its folder holds no paper */
  async updatePaperFields(paperId: string, patch: PaperFieldsPatch): Promise<PaperRecord | undefined> {
    const current = await this.findPaper(paperId);
    const written = current && (await updatePaperFields(this.ctx, current.path, patch));
    return current && written && this.absorbOwnedFields(current, written);
  }

  /** Adds and removes tags on several papers. @returns the papers changed and the failures */
  async editTags(paperIds: string[], add: string[], remove: string[]): Promise<BatchOutcome> {
    const { refs, unknown } = await this.refsFor(paperIds);
    const outcome = await editPaperTags(this.ctx, refs.map(({ paper }) => paper), add, remove);
    for (const written of outcome.records) {
      const current = refs.find(({ paper }) => paper.id === written.id)?.record;
      if (current) { await this.absorbOwnedFields(current, written); }
    }
    return { done: outcome.done, failed: [...unknown, ...outcome.failed] };
  }

  /** Overwrites a paper's bibliographic fields with resolved ones. @returns the updated paper, or undefined when unknown */
  async applyResolvedMetadata(paperId: string, metadata: RecordMetadata): Promise<PaperRecord | undefined> {
    const current = await this.findPaper(paperId);
    return current && this.rewriteRecord(withResolvedMetadata(current, metadata));
  }

  /**
   * Re-reads a paper's PDF through the import pipeline, for records imported offline or before the pipeline improved.
   * @returns the updated paper, or undefined when nothing better was found
   */
  async refreshMetadataFromPdf(paperId: string): Promise<PaperRecord | undefined> {
    const paper = await this.findPaper(paperId);
    if (!paper) { return undefined; }
    let bytes: Uint8Array;
    try {
      bytes = await this.ctx.fs.readFile(paperFiles(paper.path, path.join).pdf);
    } catch {
      return undefined;
    }
    if (bytes.byteLength === 0) { return undefined; }
    const parsed = await this.parse(bytes, paper.citeKey);
    // A second guess is not better than the guess already stored.
    if (parsed.confidence === "low" || (!parsed.doi && parsed.confidence !== "high")) { return undefined; }
    return this.applyResolvedMetadata(paperId, parsed);
  }

  /** Rewrites a record's files, keeping the reading status, tags and note the files hold, then updates the index. */
  async rewriteRecord(record: PaperRecord): Promise<PaperRecord> {
    const written = await writePaperRecord(this.ctx, record, { ownsStatus: false });
    await this.putUpdated(written);
    return written;
  }

  /** @returns how many papers had their metadata.yaml and bib.bib rewritten */
  async regenerateBibTeX(): Promise<number> {
    const papers = await this.database.listPapers();
    for (const paper of papers) {
      await writePaperRecord(this.ctx, paper, { ownsStatus: false });
    }
    return papers.length;
  }

  /** Drops a paper from the index only; its files stay where they are. */
  async removeFromIndex(paperId: string): Promise<void> {
    await this.database.deletePaper(paperId);
    this.eventBus.emit(EVENTS.PAPER_DELETED, { id: paperId });
  }

  /** Sends paper folders to the trash; a paper whose trash fails stays in the index. @returns what was trashed and the failures */
  async trashPapers(paperIds: string[]): Promise<BatchOutcome> {
    const { refs, unknown } = await this.refsFor(paperIds);
    const outcome = await trashPapers(this.ctx, refs.map(({ paper }) => paper));
    for (const id of outcome.done) { await this.removeFromIndex(id); }
    return { done: outcome.done, failed: [...unknown, ...outcome.failed] };
  }

  /** Moves paper folders into targetDir and re-points their records. @returns the moves made and the failures */
  async movePapers(paperIds: string[], targetDir: string): Promise<MoveOutcome> {
    const { refs, unknown } = await this.refsFor(paperIds);
    const outcome = await movePapers(this.ctx, refs.map(({ paper }) => paper), targetDir);
    for (const move of outcome.moves) { await this.relocatePapersUnder(move.from, move.to); }
    return { ...outcome, failed: [...unknown, ...outcome.failed] };
  }

  /** Re-points the records of every paper under a folder that was renamed or moved. */
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<void> {
    const { updated } = await new FolderService(this.database, path.sep).relocatePapersUnder(oldDir, newDir);
    for (const paper of updated) { this.eventBus.emit(EVENTS.PAPER_UPDATED, paper); }
  }

  /** Drops the records of every paper under a folder that was trashed. */
  async removePapersUnder(dirPath: string): Promise<void> {
    const { removedIds } = await new FolderService(this.database, path.sep).removePapersUnder(dirPath);
    for (const id of removedIds) { this.eventBus.emit(EVENTS.PAPER_DELETED, { id }); }
  }

  private async putUpdated(paper: PaperRecord): Promise<void> {
    await this.database.upsertPaper(paper);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
  }

  // The file's copy of the user's fields wins, but an unchanged paper is not re-announced: sync and the AI index
  // react to every update. The indexed hasPdf stays, since the indexer and this disk read count symlinks differently.
  private async absorbOwnedFields(current: PaperRecord, written: PaperRecord): Promise<PaperRecord> {
    const { hasPdf: _diskHasPdf, ...fields } = written;
    const next: PaperRecord = { ...fields, ...(current.hasPdf === undefined ? {} : { hasPdf: current.hasPdf }) };
    const same = next.status === current.status && (next.note ?? "") === (current.note ?? "")
      && (next.tags ?? []).join("\n") === (current.tags ?? []).join("\n");
    if (!same) { await this.putUpdated(next); }
    return next;
  }

  private async refsFor(paperIds: string[]): Promise<{
    refs: Array<{ paper: PaperRef; record: PaperRecord }>;
    unknown: Array<{ id: string; error: string }>;
  }> {
    const byId = new Map((await this.database.listPapers()).map((paper) => [paper.id, paper]));
    const refs: Array<{ paper: PaperRef; record: PaperRecord }> = [];
    const unknown: Array<{ id: string; error: string }> = [];
    for (const id of paperIds) {
      const record = byId.get(id);
      if (record) { refs.push({ paper: { id, path: record.path }, record }); } else { unknown.push({ id, error: "Paper not found" }); }
    }
    return { refs, unknown };
  }
}
