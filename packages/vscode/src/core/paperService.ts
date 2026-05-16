/**
 * Module: Paper Service
 * Responsibility: Drive paper import, metadata persistence, and deletion
 * Dependencies: filesystem, database, event bus, pdf parser, bibtex service
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { EVENTS } from "../constants/events.js";
import type { PaperRecord, BatchImportResult } from "./types.js";
import { ExtensionEventBus } from "./eventBus.js";
import type { ResearchDatabase } from "../db/database.js";
import { FileSystemService } from "../storage/fileSystemService.js";
import type { ILibraryPaths } from "../storage/paths/libraryPaths.js";
import { PdfImportParser } from "../pdf/pdfImportParser.js";
import { BibTeXService } from "../bibtex/bibtexService.js";

export class PaperService {
  constructor(
    private readonly fsService: FileSystemService,
    private readonly database: ResearchDatabase,
    private readonly eventBus: ExtensionEventBus,
    private readonly paths: ILibraryPaths,
    private readonly pdfImportParser: PdfImportParser,
    private readonly bibTeXService: BibTeXService,
  ) {}

  async addPaperFromUri(sourceUri: vscode.Uri, targetParentDir?: vscode.Uri): Promise<PaperRecord> {
    const parsed = await this.pdfImportParser.parse(sourceUri);
    const paperId = parsed.citeKey || path.basename(sourceUri.fsPath, path.extname(sourceUri.fsPath)) || crypto.randomUUID();
    const parentDir = targetParentDir ?? this.paths.papersRoot();
    const targetFolder = vscode.Uri.joinPath(parentDir, paperId);
    await this.fsService.ensureDirectory(targetFolder);

    const targetPdf = vscode.Uri.joinPath(targetFolder, "paper.pdf");
    const content = await vscode.workspace.fs.readFile(sourceUri);
    await vscode.workspace.fs.writeFile(targetPdf, content);

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
    await this.bibTeXService.writePaperArtifacts(targetFolder, paper, sourceUri.fsPath);
    this.eventBus.emit(EVENTS.PAPER_ADDED, paper);
    return paper;
  }

  async listPapers(): Promise<PaperRecord[]> {
    return this.database.listPapers();
  }

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

  // Rewrites stored paper paths after a collection folder is renamed or moved
  // on disk, so the index keeps pointing at the relocated paper folders.
  async relocatePapersUnder(oldDir: string, newDir: string): Promise<void> {
    const papers = await this.database.listPapers();
    const prefix = oldDir + path.sep;
    for (const paper of papers) {
      if (paper.path !== oldDir && !paper.path.startsWith(prefix)) {
        continue;
      }
      const relative = path.relative(oldDir, paper.path);
      const next: PaperRecord = { ...paper, path: path.join(newDir, relative) };
      await this.database.upsertPaper(next);
      this.eventBus.emit(EVENTS.PAPER_UPDATED, next);
    }
  }

  // Drops index entries for every paper stored under `dirPath`. Used when a
  // collection folder is deleted — the folder's files are removed separately.
  async removePapersUnder(dirPath: string): Promise<void> {
    const papers = await this.database.listPapers();
    const prefix = dirPath + path.sep;
    for (const paper of papers) {
      if (paper.path !== dirPath && !paper.path.startsWith(prefix)) {
        continue;
      }
      await this.database.deletePaper(paper.id);
      this.eventBus.emit(EVENTS.PAPER_DELETED, { id: paper.id });
    }
  }

  async regenerateBibTeX(): Promise<number> {
    const papers = await this.database.listPapers();
    for (const paper of papers) {
      const paperFolder = vscode.Uri.file(paper.path);
      await this.bibTeXService.writePaperArtifacts(paperFolder, paper, `${paper.path}/paper.pdf`);
    }

    return papers.length;
  }
}
