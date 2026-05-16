/**
 * Module: VscodeLocalFileSystem
 * Responsibility: Adapt vscode.workspace.fs (Uri-based) to the LocalFileSystem
 *   interface (absolute-path string-based) required by the sync engine
 * Dependencies: vscode
 */
import * as vscode from "vscode";
import type { LocalFileSystem, LocalStat } from "./syncTypes.js";

export class VscodeLocalFileSystem implements LocalFileSystem {
  async listDir(dirPath: string): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
      return entries.map(([name]) => name);
    } catch {
      return [];
    }
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), content);
  }

  async deleteFile(filePath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: false });
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
      return {
        isFile: s.type === vscode.FileType.File,
        isDirectory: s.type === vscode.FileType.Directory,
        mtimeMs: s.mtime,
        size: s.size,
      };
    } catch {
      return undefined;
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  }
}
