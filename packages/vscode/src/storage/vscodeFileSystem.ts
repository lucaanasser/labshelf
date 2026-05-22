/**
 * Adapts vscode.workspace.fs to the IFileSystem string-path interface from
 * @labshelf/core so platform-agnostic services (BibTeXService, future
 * paperService) can operate on absolute paths instead of vscode.Uri objects.
 *
 * @depends vscode, @labshelf/core
 * @dependents extension.ts (passed to BibTeXService)
 */
import * as vscode from "vscode";
import type { IFileSystem } from "@labshelf/core";

export class VscodeFileSystem implements IFileSystem {
  async ensureDir(path: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path));
  }

  async writeText(path: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path), Buffer.from(content, "utf8"));
  }

  async readText(path: string): Promise<string> {
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    return Buffer.from(data).toString("utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return true;
    } catch {
      return false;
    }
  }
}
