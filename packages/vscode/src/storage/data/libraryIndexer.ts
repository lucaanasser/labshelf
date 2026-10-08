/**
 * Rebuilds the SQLite papers cache by scanning metadata.yaml files on disk.
 */
import * as vscode from "vscode";

import type { LibraryLayout, PaperRecord, IResearchDatabase } from "@labshelf/core";
import { METADATA_FILE, PDF_FILE, paperRecordFromMetadata, parsePaperMetadata } from "@labshelf/core";
import type { VscodeFileSystem } from "../vscodeFileSystem.js";

/**
 * Idempotent indexer that walks the library tree and upserts all papers into SQLite.
 */
export class LibraryIndexer {
  constructor(
    private readonly paths: LibraryLayout<vscode.Uri>,
    private readonly fileSystem: VscodeFileSystem,
    private readonly database: IResearchDatabase,
  ) {}

  /**
   * Scans papers/ and .research/papers/ and rebuilds the full SQLite cache via upsert.
     * @returns the count of indexed papers
   */
  async rebuild(): Promise<{ papers: number }> {
    const papers = await this.scanPapers();

    for (const paper of papers) {
      await this.database.upsertPaper(paper);
    }

    return { papers: papers.length };
  }

  // Walks papers/** collecting every folder that contains a metadata.yaml.
  private async scanPapers(): Promise<PaperRecord[]> {
    const found: PaperRecord[] = [];
    await this.walk(this.paths.papersRoot(), found);
    return found;
  }

  // Recursively walks a directory, collecting papers from folders that contain metadata.yaml.
  private async walk(dir: vscode.Uri, found: PaperRecord[]): Promise<void> {
    const entries = await this.fileSystem.listEntries(dir.fsPath);
    if (entries.some(([name, type]) => name === METADATA_FILE && type === vscode.FileType.File)) {
      // The directory listing already tells us whether the PDF is present, so
      // the honest-attachment flag costs no extra syscall. FileType is a bit
      // flag: a symlink to a file reports File|SymbolicLink, so test the bit.
      const hasPdf = entries.some(([name, type]) => name === PDF_FILE && (type & vscode.FileType.File) !== 0);
      const paper = await this.readPaper(dir, vscode.Uri.joinPath(dir, METADATA_FILE), hasPdf);
      if (paper) {
        found.push(paper);
      }
      return;
    }
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        await this.walk(vscode.Uri.joinPath(dir, name), found);
      }
    }
  }

  // The paper id is the folder name (stable, == citeKey). hasPdf is derived by walk() from the folder listing.
  private async readPaper(folder: vscode.Uri, metadataUri: vscode.Uri, hasPdf: boolean): Promise<PaperRecord | null> {
    let text: string;
    try {
      text = await this.fileSystem.readText(metadataUri.fsPath);
    } catch {
      return null;
    }
    const meta = parsePaperMetadata(text);
    return meta ? paperRecordFromMetadata(meta, { id: basename(folder), path: folder.fsPath, hasPdf }) : null;
  }
}

// Returns the last path segment of a URI (the folder name used as the paper id).
function basename(uri: vscode.Uri): string {
  const parts = uri.fsPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
