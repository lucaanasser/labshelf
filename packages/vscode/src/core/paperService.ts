/**
 * Orchestrates paper import, metadata persistence, status updates, and deletion.
 *
 * @depends @labshelf/core, storage/fileSystemService, storage/paths/libraryPaths
 * @dependents commands/registerCommands.ts, extension.ts, pdf-viewer/PdfViewerPanel.ts, ui/list/listWebviewPanel.ts
 */
import * as path from "node:path";
import * as vscode from "vscode";

import {
  EVENTS,
  ExtensionEventBus,
  PdfImportParser,
  BibTeXService,
  FolderService,
  isUnderDir,
} from "@labshelf/core";
import type {
  PaperRecord,
  BatchImportResult,
  IResearchDatabase,
  ResolvedMetadata,
  ParsedPdfImport,
} from "@labshelf/core";
import { FileSystemService } from "../storage/fileSystemService.js";
import type { ILibraryPaths } from "../storage/paths/libraryPaths.js";
import type { PdfTextLayerBuilder, TextLayerHooks, TextLayerOutcome } from "../pdf/searchablePdfBuilder.js";

/** What happened when a paper was checked for, and possibly given, a text layer. */
export type MakeSearchableResult =
  | { status: "added"; paper: PaperRecord; pagesAdded: number; pagesFailed: number }
  | { status: "not-needed" | "cancelled" }
  | { status: "unavailable"; reason: string };

/** One step of a batch import, reported just before the file is processed. */
export interface ImportProgress {
  // 1-based position of the file about to be imported.
  index: number;
  total: number;
  fileName: string;
}

export interface PaperMoveResult {
  moved: string[];
  failed: Array<{ id: string; error: string }>;
}

export class PaperService {
  constructor(
    private readonly fsService: FileSystemService,
    private readonly database: IResearchDatabase,
    private readonly eventBus: ExtensionEventBus,
    private readonly paths: ILibraryPaths,
    private readonly pdfImportParser: PdfImportParser,
    private readonly bibTeXService: BibTeXService,
    // Absent when OCR is turned off; scanned papers then stay as imported.
    private readonly textLayerBuilder?: PdfTextLayerBuilder,
  ) {}

  // Set by the most recent addPaperFromUri so batch imports can collect the
  // papers no registry confirmed, without changing the single-import signature.
  private _lastImportNeedsReview = false;

  /**
   * Imports a single PDF, copies it into the library, persists metadata, and emits PAPER_ADDED.
   * @usedBy extension.ts, commands/registerCommands.ts
   * @returns the newly created PaperRecord
   */
  async addPaperFromUri(sourceUri: vscode.Uri, targetParentDir?: vscode.Uri): Promise<PaperRecord> {
    const pdfBytes = await vscode.workspace.fs.readFile(sourceUri);
    const fileStem = path.basename(sourceUri.fsPath, path.extname(sourceUri.fsPath));
    const parsed = await this.pdfImportParser.parse(pdfBytes, fileStem);
    const paperId = parsed.citeKey || fileStem || crypto.randomUUID();
    const parentDir = targetParentDir ?? this.paths.papersRoot();
    const targetFolder = vscode.Uri.joinPath(parentDir, paperId);
    await this.fsService.ensureDirectory(targetFolder);

    const targetPdf = vscode.Uri.joinPath(targetFolder, "paper.pdf");
    // Guard against a PDF backend that transfers (detaches) the buffer it parses:
    // writing a detached array would store an unreadable zero-byte paper.pdf.
    if (pdfBytes.byteLength === 0) {
      throw new Error("PDF buffer was consumed during parsing; the file could not be copied into the library.");
    }
    await vscode.workspace.fs.writeFile(targetPdf, pdfBytes);

    const paper: PaperRecord = {
      id: paperId,
      title: parsed.title,
      path: targetFolder.fsPath,
      citeKey: paperId,
      status: "unread",
      ...(parsed.authors?.length ? { authors: parsed.authors } : {}),
      ...(parsed.year ? { year: parsed.year } : {}),
      ...(parsed.summary ? { summary: parsed.summary } : {}),
      ...(parsed.journal ? { journal: parsed.journal } : {}),
      ...(parsed.publisher ? { publisher: parsed.publisher } : {}),
      ...(parsed.volume ? { volume: parsed.volume } : {}),
      ...(parsed.issue ? { issue: parsed.issue } : {}),
      ...(parsed.pages ? { pages: parsed.pages } : {}),
      ...(parsed.doi ? { doi: parsed.doi } : {}),
      ...(parsed.url ? { url: parsed.url } : {}),
      ...(parsed.issn ? { issn: parsed.issn } : {}),
      ...(parsed.language ? { language: parsed.language } : {}),
      ...(parsed.keywords?.length ? { keywords: parsed.keywords } : {}),
    };

    await this.database.upsertPaper(paper);
    await this.bibTeXService.writePaperArtifacts(targetFolder.fsPath, paper, sourceUri.fsPath);
    this.eventBus.emit(EVENTS.PAPER_ADDED, paper);
    this._lastImportNeedsReview = needsReview(parsed);
    return paper;
  }

  /**
   * Overwrites a paper's bibliographic fields with a freshly resolved record
   * and rewrites its BibTeX artifacts; emits PAPER_UPDATED.
   * @usedBy commands/registerCommands.ts (labshelf.fetchMetadata)
   * @returns the updated PaperRecord, or undefined when the paper is unknown
   */
  async applyResolvedMetadata(paperId: string, metadata: ResolvedMetadata): Promise<PaperRecord | undefined> {
    const papers = await this.database.listPapers();
    const current = papers.find((paper) => paper.id === paperId);
    if (!current) {
      return undefined;
    }

    // Keep identity fields: the folder on disk is named after the cite key.
    const updated: PaperRecord = {
      ...current,
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.authors?.length ? { authors: metadata.authors } : {}),
      ...(metadata.year ? { year: metadata.year } : {}),
      ...(metadata.summary ? { summary: metadata.summary } : {}),
      ...(metadata.journal ? { journal: metadata.journal } : {}),
      ...(metadata.publisher ? { publisher: metadata.publisher } : {}),
      ...(metadata.volume ? { volume: metadata.volume } : {}),
      ...(metadata.issue ? { issue: metadata.issue } : {}),
      ...(metadata.pages ? { pages: metadata.pages } : {}),
      ...(metadata.doi ? { doi: metadata.doi } : {}),
      ...(metadata.url ? { url: metadata.url } : {}),
      ...(metadata.issn ? { issn: metadata.issn } : {}),
      ...(metadata.language ? { language: metadata.language } : {}),
      ...(metadata.keywords?.length ? { keywords: metadata.keywords } : {}),
    };

    await this.database.upsertPaper(updated);
    await this.bibTeXService.writePaperArtifacts(updated.path, updated, `${updated.path}${path.sep}paper.pdf`);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, updated);
    return updated;
  }

  /**
   * Re-runs the full extraction pipeline against a paper already in the
   * library. Recovers records that were imported while offline, before the
   * pipeline improved, or when a registry was rate-limiting.
   * @usedBy commands/registerCommands.ts (labshelf.resolveMissingMetadata)
   * @returns the updated paper, or undefined when nothing better was found
   */
  async refreshMetadataFromPdf(paperId: string): Promise<PaperRecord | undefined> {
    const papers = await this.database.listPapers();
    const paper = papers.find((entry) => entry.id === paperId);
    if (!paper) {
      return undefined;
    }

    const pdfUri = vscode.Uri.file(path.join(paper.path, "paper.pdf"));
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await vscode.workspace.fs.readFile(pdfUri);
    } catch {
      return undefined;
    }
    if (pdfBytes.byteLength === 0) {
      return undefined;
    }

    const parsed = await this.pdfImportParser.parse(pdfBytes, paper.citeKey);
    // Only overwrite when the pipeline actually recognised the paper this time;
    // a second guess is not better than the guess already stored.
    if (parsed.confidence === "low" || (!parsed.doi && parsed.confidence !== "high")) {
      return undefined;
    }

    return this.applyResolvedMetadata(paperId, parsed);
  }

  /**
   * Gives a scanned paper a text layer so it can be searched and selected, and
   * replaces paper.pdf with the result; emits PAPER_UPDATED so the text is
   * re-indexed. Papers that already have text are left untouched.
   * @usedBy commands/textLayerQueue.ts
   * @returns what was done, or why nothing could be
   */
  async makeSearchable(paperId: string, hooks?: TextLayerHooks): Promise<MakeSearchableResult> {
    if (!this.textLayerBuilder) {
      return { status: "unavailable", reason: "OCR is turned off (labshelf.ocr.enabled / labshelf.ocr.makeSearchable)" };
    }
    const paper = (await this.database.listPapers()).find((entry) => entry.id === paperId);
    if (!paper) {
      return { status: "unavailable", reason: "paper not found" };
    }

    const pdfUri = vscode.Uri.file(path.join(paper.path, "paper.pdf"));
    let outcome: TextLayerOutcome;
    try {
      outcome = await this.textLayerBuilder.build(await vscode.workspace.fs.readFile(pdfUri), hooks);
    } catch (error) {
      return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
    if (outcome.status !== "added") {
      return outcome;
    }

    // Written beside the original and renamed over it, so an interrupted write
    // can never leave the library with half a paper.
    const pendingUri = vscode.Uri.file(path.join(paper.path, "paper.searchable.tmp"));
    await vscode.workspace.fs.writeFile(pendingUri, outcome.bytes);
    await vscode.workspace.fs.rename(pendingUri, pdfUri, { overwrite: true });

    this.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
    return { status: "added", paper, pagesAdded: outcome.pagesAdded, pagesFailed: outcome.pagesFailed };
  }

  /**
   * Returns every paper whose record was never confirmed against a registry.
   * @usedBy commands/registerCommands.ts
   * @returns papers worth re-resolving or filling in by hand
   */
  async listUnresolvedPapers(): Promise<PaperRecord[]> {
    const papers = await this.database.listPapers();
    return papers.filter((paper) => !paper.doi);
  }

  /**
   * Returns all papers currently stored in the database, ordered by title.
   * @usedBy commands/registerCommands.ts, extension.ts, ui/list/listWebviewPanel.ts
   * @returns array of PaperRecord
   */
  async listPapers(): Promise<PaperRecord[]> {
    return this.database.listPapers();
  }

  /**
   * Locates a paper's PDF from its stored record. The id alone is not enough: a paper can sit in any collection folder under papers/, and moves with it.
   * @usedBy extension.ts (AI indexer)
   * @returns URI of the paper's paper.pdf, or null when the id is unknown
   */
  async resolvePdfUri(paperId: string): Promise<vscode.Uri | null> {
    const paper = (await this.database.listPapers()).find((p) => p.id === paperId);
    return paper ? vscode.Uri.file(path.join(paper.path, "paper.pdf")) : null;
  }

  /**
   * Updates the read-status of one paper and emits PAPER_UPDATED; returns undefined if not found.
   * @usedBy ui/list/listWebviewPanel.ts
   * @returns updated PaperRecord or undefined
   */
  async updatePaperStatus(paperId: string, status: PaperRecord["status"]): Promise<PaperRecord | undefined> {
    const papers = await this.database.listPapers();
    const current = papers.find((paper) => paper.id === paperId);
    if (!current) {
      return undefined;
    }

    const next: PaperRecord = { ...current, status };
    await this.database.upsertPaper(next);
    this.eventBus.emit(EVENTS.PAPER_UPDATED, next);
    return next;
  }

  /**
   * Removes a paper from the index and optionally sends its folder to the trash; emits PAPER_DELETED.
   * @usedBy commands/registerCommands.ts, ui/list/listWebviewPanel.ts
   * @returns true if the paper existed and was deleted, false if not found
   */
  async deletePaper(paperId: string, deleteFiles: boolean): Promise<boolean> {
    const papers = await this.database.listPapers();
    const paper = papers.find((p) => p.id === paperId);
    if (!paper) {
      return false;
    }

    await this.database.deletePaper(paperId);

    if (deleteFiles) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(paper.path), { recursive: true, useTrash: true });
      } catch {
        // Files may already be missing; deletion from index is the critical step
      }
    }

    this.eventBus.emit(EVENTS.PAPER_DELETED, { id: paperId });
    return true;
  }

  /**
   * Imports multiple PDFs or folders of PDFs, collecting per-file successes, failures, and skipped paths.
   * A single import can take ten seconds or more (OCR, registry lookups), so
   * onProgress lets the caller show which file is being worked on.
   * @usedBy commands/importProgress.ts
   * @returns BatchImportResult with success, failed, and skipped arrays
   */
  async addPapersFromUris(
    uris: vscode.Uri[],
    targetParentDir?: vscode.Uri,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<BatchImportResult> {
    const result: BatchImportResult = { success: [], failed: [], skipped: [], needsReview: [] };
    const pdfs = await this._expandToPdfs(uris, result.skipped);
    for (const [position, pdfUri] of pdfs.entries()) {
      onProgress?.({ index: position + 1, total: pdfs.length, fileName: path.basename(pdfUri.fsPath) });
      try {
        const paper = await this.addPaperFromUri(pdfUri, targetParentDir);
        result.success.push(paper);
        if (this._lastImportNeedsReview) {
          result.needsReview?.push(paper);
        }
      } catch (error) {
        result.failed.push({
          path: pdfUri.fsPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }

  // Expands a mix of file and directory URIs into a flat list of PDF URIs, populating skipped for non-PDFs.
  private async _expandToPdfs(uris: vscode.Uri[], skipped: string[]): Promise<vscode.Uri[]> {
    const pdfs: vscode.Uri[] = [];
    for (const uri of uris) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          pdfs.push(...await this._findPdfsInFolder(uri));
        } else if (uri.fsPath.toLowerCase().endsWith(".pdf")) {
          pdfs.push(uri);
        } else {
          skipped.push(uri.fsPath);
        }
      } catch {
        skipped.push(uri.fsPath);
      }
    }
    return pdfs;
  }

  // Recursively collects all PDF files inside a directory tree.
  private async _findPdfsInFolder(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
    const pdfs: vscode.Uri[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(folderUri);
      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(folderUri, name);
        if (type === vscode.FileType.Directory) {
          pdfs.push(...await this._findPdfsInFolder(child));
        } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".pdf")) {
          pdfs.push(child);
        }
      }
    } catch {
      // Folder unreadable — skip silently
    }
    return pdfs;
  }

  /**
   * Rewrites stored paper paths after a collection folder is renamed or moved so the index stays valid.
   * @usedBy extension.ts
   * @returns void
   */
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<void> {
    const { updated } = await this._folderService().relocatePapersUnder(oldDir, newDir);
    for (const paper of updated) {
      this.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
    }
  }

  /**
   * Drops index entries for every paper stored under dirPath, emitting PAPER_DELETED for each.
   * @usedBy extension.ts
   * @returns void
   */
  async removePapersUnder(dirPath: string): Promise<void> {
    const { removedIds } = await this._folderService().removePapersUnder(dirPath);
    for (const id of removedIds) {
      this.eventBus.emit(EVENTS.PAPER_DELETED, { id });
    }
  }

  /**
   * Moves paper folders into targetDir on disk and re-points their records; papers already there are skipped.
   * @usedBy ui/list/listWebviewPanel.ts
   * @returns the ids that moved and the per-paper failures (for example a name collision in the target)
   */
  async movePapers(paperIds: string[], targetDir: string): Promise<PaperMoveResult> {
    const byId = new Map((await this.database.listPapers()).map((p) => [p.id, p]));
    const result: PaperMoveResult = { moved: [], failed: [] };

    for (const id of paperIds) {
      const paper = byId.get(id);
      if (!paper) {
        result.failed.push({ id, error: "Paper not found" });
        continue;
      }
      if (path.dirname(paper.path) === targetDir) {
        continue;
      }
      const destination = path.join(targetDir, path.basename(paper.path));
      try {
        await vscode.workspace.fs.rename(vscode.Uri.file(paper.path), vscode.Uri.file(destination), { overwrite: false });
        await this.relocatePapersUnder(paper.path, destination);
        result.moved.push(id);
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }

  /**
   * Moves a collection folder into targetParentDir and re-points every paper stored under it.
   * @usedBy extension.ts
   * @returns the folder's new absolute path
   */
  async moveFolder(dirPath: string, targetParentDir: string): Promise<string> {
    if (path.dirname(dirPath) === targetParentDir) {
      throw new Error("The folder is already there.");
    }
    if (isUnderDir(targetParentDir, dirPath, path.sep)) {
      throw new Error("A folder cannot be moved into itself.");
    }
    const destination = path.join(targetParentDir, path.basename(dirPath));
    await vscode.workspace.fs.rename(vscode.Uri.file(dirPath), vscode.Uri.file(destination), { overwrite: false });
    await this.relocatePapersUnder(dirPath, destination);
    return destination;
  }

  // FolderService is platform-agnostic; we instantiate per call so it always
  // sees the same database instance even if listPapers caches change.
  private _folderService(): FolderService {
    return new FolderService(this.database, path.sep);
  }

  /**
   * Re-writes the BibTeX and metadata artifacts for every paper in the library.
   * @usedBy commands/registerCommands.ts
   * @returns count of papers processed
   */
  async regenerateBibTeX(): Promise<number> {
    const papers = await this.database.listPapers();
    for (const paper of papers) {
      await this.bibTeXService.writePaperArtifacts(paper.path, paper, `${paper.path}/paper.pdf`);
    }

    return papers.length;
  }
}

// A record is worth reviewing when no registry confirmed it: the title and
// authors then come from the PDF's own layout or its filename.
function needsReview(parsed: ParsedPdfImport): boolean {
  return parsed.confidence !== "high" && !parsed.doi;
}
