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
} from "@labshelf/core";
import type {
  PaperRecord,
  BatchImportResult,
  IResearchDatabase,
} from "@labshelf/core";
import { FileSystemService } from "../storage/fileSystemService.js";
import type { ILibraryPaths } from "../storage/paths/libraryPaths.js";

export class PaperService {
  constructor(
    private readonly fsService: FileSystemService,
    private readonly database: IResearchDatabase,
    private readonly eventBus: ExtensionEventBus,
    private readonly paths: ILibraryPaths,
    private readonly pdfImportParser: PdfImportParser,
    private readonly bibTeXService: BibTeXService,
  ) {}

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
    };

    await this.database.upsertPaper(paper);
    await this.bibTeXService.writePaperArtifacts(targetFolder.fsPath, paper, sourceUri.fsPath);
    this.eventBus.emit(EVENTS.PAPER_ADDED, paper);
    return paper;
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
   * @usedBy commands/registerCommands.ts, extension.ts
   * @returns BatchImportResult with success, failed, and skipped arrays
   */
  async addPapersFromUris(uris: vscode.Uri[], targetParentDir?: vscode.Uri): Promise<BatchImportResult> {
    const result: BatchImportResult = { success: [], failed: [], skipped: [] };
    const pdfs = await this._expandToPdfs(uris, result.skipped);
    for (const pdfUri of pdfs) {
      try {
        const paper = await this.addPaperFromUri(pdfUri, targetParentDir);
        result.success.push(paper);
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
