/**
 * Provides thin, testable wrappers around the VS Code workspace filesystem API.
 *
 * @depends none (vscode API only)
 * @dependents bibtex/bibtexService.ts, core/logger.ts, core/paperService.ts, db/sqliteResearchDatabase.ts, extension.ts, storage/data/libraryIndexer.ts, storage/data/paperDataStore.ts, storage/paths/libraryLocation.ts
 */
import * as vscode from "vscode";

export class FileSystemService {
  /**
   * Creates a directory (and any parents) at the given URI, throwing if creation fails.
   * @usedBy bibtex/bibtexService.ts, core/logger.ts, core/paperService.ts, db/sqliteResearchDatabase.ts, extension.ts, storage/data/paperDataStore.ts, storage/paths/libraryLocation.ts
   * @returns void
   */
  async ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ensure directory ${uri.fsPath}: ${message}`);
    }
  }

  /**
   * Writes a UTF-8 string to a file, overwriting any existing content.
   * @usedBy bibtex/bibtexService.ts, core/logger.ts, storage/data/paperDataStore.ts
   * @returns void
   */
  async writeText(uri: vscode.Uri, content: string): Promise<void> {
    const data = Buffer.from(content, "utf8");
    await vscode.workspace.fs.writeFile(uri, data);
  }

  /**
   * Reads a file and returns its contents as a UTF-8 string.
   * @usedBy core/logger.ts, storage/data/libraryIndexer.ts, storage/data/paperDataStore.ts
   * @returns file contents as string
   */
  async readText(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString("utf8");
  }

  /**
   * Returns true if the path exists (file or directory), false otherwise.
   * @usedBy storage/data/paperDataStore.ts
   * @returns boolean
   */
  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists the immediate children of a directory, returning an empty array when the directory is missing.
   * @usedBy storage/data/libraryIndexer.ts
   * @returns array of [name, FileType] tuples
   */
  async readDirectory(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return [];
    }
  }
}