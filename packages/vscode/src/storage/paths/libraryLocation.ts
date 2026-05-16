/**
 * Persists, resolves, and sets up the central LabShelf library directory using VS Code globalState.
 *
 * @depends storage/fileSystemService
 * @dependents extension.ts, storage/index.ts, storage/paths/index.ts
 */
import * as vscode from "vscode";

import type { FileSystemService } from "../fileSystemService.js";

const LIBRARY_ROOT_KEY = "labshelf.libraryRoot";

/**
 * Reads the stored library root path from globalState and validates that it still exists on disk.
 * @usedBy extension.ts
 * @returns URI of the library root, or undefined if unset or inaccessible
 */
export async function resolveLibraryRoot(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  const stored = context.globalState.get<string>(LIBRARY_ROOT_KEY);
  if (!stored) {
    return undefined;
  }

  const uri = vscode.Uri.file(stored);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.Directory) {
      return undefined;
    }
    return uri;
  } catch {
    // Path no longer accessible
    return undefined;
  }
}

/**
 * Saves the given library root URI to globalState so it persists across sessions.
 * @usedBy storage/paths/libraryLocation.ts (runLibrarySetupWizard)
 * @returns void
 */
export async function persistLibraryRoot(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  await context.globalState.update(LIBRARY_ROOT_KEY, uri.fsPath);
}

/**
 * Creates all required LabShelf subdirectories under root if they do not already exist.
 * @usedBy extension.ts, storage/paths/libraryLocation.ts (runLibrarySetupWizard)
 * @returns void
 */
export async function ensureLibraryStructure(root: vscode.Uri, fsService: FileSystemService): Promise<void> {
  await fsService.ensureDirectory(vscode.Uri.joinPath(root, ".research"));
  await fsService.ensureDirectory(vscode.Uri.joinPath(root, ".research", "logs"));
  await fsService.ensureDirectory(vscode.Uri.joinPath(root, ".research", "papers"));
  await fsService.ensureDirectory(vscode.Uri.joinPath(root, ".research", "sync"));
  await fsService.ensureDirectory(vscode.Uri.joinPath(root, "papers"));
}

/**
 * Runs the first-use folder-picker wizard and creates the library structure at the chosen location.
 * @usedBy extension.ts
 * @returns the configured library root URI, or undefined if the user cancelled
 */
export async function runLibrarySetupWizard(
  context: vscode.ExtensionContext,
  fsService: FileSystemService,
): Promise<vscode.Uri | undefined> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select base folder for library",
    title: "LabShelf: Choose Library Location",
  });

  if (!folders || folders.length === 0) {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const baseFolderUri = folders[0]!;

  const name = await vscode.window.showInputBox({
    prompt: "Library folder name (will be created inside the selected folder)",
    placeHolder: "LabShelfLibrary",
    value: "LabShelfLibrary",
    validateInput: (v) => (v.trim() ? undefined : "Name cannot be empty"),
  });

  if (!name?.trim()) {
    return undefined;
  }

  const libraryRoot = vscode.Uri.joinPath(baseFolderUri, name.trim());

  try {
    await fsService.ensureDirectory(libraryRoot);
    await ensureLibraryStructure(libraryRoot, fsService);
    await persistLibraryRoot(context, libraryRoot);
    return libraryRoot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf: Failed to create library at ${libraryRoot.fsPath}: ${message}`);
    return undefined;
  }
}

/**
 * Re-runs the setup wizard to let the user choose a new library location (used when the stored path is invalid).
 * @usedBy extension.ts (indirectly via storage/index.ts)
 * @returns the new library root URI, or undefined if the user cancelled
 */
export async function reconfigureLibrary(
  context: vscode.ExtensionContext,
  fsService: FileSystemService,
): Promise<vscode.Uri | undefined> {
  return runLibrarySetupWizard(context, fsService);
}
