/**
 * Module: File System Service
 * Responsibility: Perform workspace filesystem operations
 * Dependencies: vscode
 */
import * as vscode from "vscode";

export class FileSystemService {
  async ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ensure directory ${uri.fsPath}: ${message}`);
    }
  }

  async writeText(uri: vscode.Uri, content: string): Promise<void> {
    const data = Buffer.from(content, "utf8");
    await vscode.workspace.fs.writeFile(uri, data);
  }

  async readText(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString("utf8");
  }

  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  // Lists the immediate children of a directory. Returns [] when the
  // directory is missing so callers can treat absence as "no entries".
  async readDirectory(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return [];
    }
  }
}