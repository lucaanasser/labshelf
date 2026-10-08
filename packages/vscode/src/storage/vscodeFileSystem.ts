/** The one file-system adapter of the VS Code extension: the LibraryFileSystem port over vscode.workspace.fs. */
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import * as vscode from "vscode";
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

const uriOf = (target: string): vscode.Uri => vscode.Uri.file(target);

const isNotFound = (error: unknown): boolean => (error as { code?: string }).code === "FileNotFound";

export class VscodeFileSystem implements LibraryFileSystem {
  /** tmpDir holds the temp files of atomic writes; it lives outside the synced roots. */
  constructor(private readonly tmpDir: string) {}

  async ensureDir(dirPath: string): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uriOf(dirPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ensure directory ${dirPath}: ${message}`, { cause: error });
    }
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await this.writeFile(filePath, Buffer.from(content, "utf8"));
  }

  // Written to a temp file and renamed into place, so a reader, a sync scan or the other app never sees half a file.
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await this.ensureDir(this.tmpDir);
    const tmp = uriOf(path.join(this.tmpDir, `.${path.basename(filePath)}.${randomUUID()}.tmp`));
    try {
      await vscode.workspace.fs.writeFile(tmp, content);
      await vscode.workspace.fs.rename(tmp, uriOf(filePath), { overwrite: true });
    } catch (error) {
      // Best effort: the write error below is the one the caller needs, and a stray temp file is harmless.
      await Promise.resolve(vscode.workspace.fs.delete(tmp, { useTrash: false })).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write ${filePath}: ${message}`, { cause: error });
    }
  }

  async readText(filePath: string): Promise<string> {
    return Buffer.from(await this.readFile(filePath)).toString("utf8");
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(uriOf(filePath));
  }

  /** True for files and folders. */
  async exists(target: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uriOf(target));
      return true;
    } catch {
      return false;
    }
  }

  // Only a missing folder lists as empty: an import walk must be able to report a folder it may not read.
  async listDir(dirPath: string): Promise<string[]> {
    try {
      return (await vscode.workspace.fs.readDirectory(uriOf(dirPath))).map(([name]) => name);
    } catch (error) {
      if (isNotFound(error)) { return []; }
      throw error;
    }
  }

  /** The children of a folder with their types in one call; [] when it is missing or unreadable, so one bad folder does not stop an index rebuild. */
  async listEntries(dirPath: string): Promise<Array<[string, vscode.FileType]>> {
    try {
      return await vscode.workspace.fs.readDirectory(uriOf(dirPath));
    } catch {
      return [];
    }
  }

  // A missing file is already deleted; any other failure (permissions, a locked file) still surfaces.
  async deleteFile(filePath: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uriOf(filePath), { useTrash: false });
    } catch (error) {
      if (isNotFound(error)) { return; }
      throw error;
    }
  }

  // VS Code allows a rename that changes only letter case even without overwrite, so "ml" → "ML" works on macOS.
  async rename(from: string, to: string): Promise<void> {
    await vscode.workspace.fs.rename(uriOf(from), uriOf(to), { overwrite: false });
  }

  async trash(target: string): Promise<void> {
    await vscode.workspace.fs.delete(uriOf(target), { recursive: true, useTrash: true });
  }

  async mkdir(dir: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(uriOf(dir));
  }

  // FileType is a bit flag and a symlink reports File|SymbolicLink: the strict comparison leaves symlinks out.
  async stat(target: string): Promise<LocalStat | undefined> {
    try {
      const s = await vscode.workspace.fs.stat(uriOf(target));
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
}
