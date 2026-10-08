/**
 * Persists, resolves, and sets up the central LabShelf library directory using VS Code globalState, mirrored in the
 * config file shared with the terminal app so both open the same library.
 *
 * @depends storage/paths/sharedConfig
 * @dependents extension.ts, storage/index.ts, storage/paths/index.ts
 */
import * as vscode from "vscode";

import { libraryLayout, type IFileSystem } from "@labshelf/core";

import { readSharedLibraryRoot, writeSharedLibraryRoot } from "./sharedConfig.js";

const LIBRARY_ROOT_KEY = "labshelf.libraryRoot";

/**
 * Reads the stored library root path from globalState and validates that it still exists on disk.
 * @usedBy extension.ts
 * @returns URI of the library root, or undefined if unset or inaccessible
 */
export async function resolveLibraryRoot(context: vscode.ExtensionContext): Promise<vscode.Uri | undefined> {
  // A library set up in the terminal app first is adopted from the shared config.
  const stored = context.globalState.get<string>(LIBRARY_ROOT_KEY) ?? (await readSharedLibraryRoot());
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
  await mirrorLibraryRoot(uri);
}

/**
 * Records the library root in the shared config for the terminal app; failures only cost the terminal its default.
 * @usedBy persistLibraryRoot, extension.ts (activation, for libraries configured before the shared file existed)
 * @returns void
 */
export async function mirrorLibraryRoot(uri: vscode.Uri): Promise<void> {
  try {
    await writeSharedLibraryRoot(uri.fsPath);
  } catch {
    // Read-only home or similar: VS Code keeps working from globalState.
  }
}

/**
 * Creates all required LabShelf subdirectories under root if they do not already exist.
 * @usedBy extension.ts, storage/paths/libraryLocation.ts (runLibrarySetupWizard)
 * @returns void
 */
export async function ensureLibraryStructure(root: vscode.Uri, fileSystem: IFileSystem): Promise<void> {
  for (const dir of libraryLayout(root, vscode.Uri.joinPath).requiredDirs()) {
    await fileSystem.ensureDir(dir.fsPath);
  }
}

/**
 * Runs the first-use folder-picker wizard and creates the library structure at the chosen location, through the
 * file system the factory returns for the chosen root.
 * @usedBy extension.ts
 * @returns the configured library root URI, or undefined if the user cancelled
 */
export async function runLibrarySetupWizard(
  context: vscode.ExtensionContext,
  createFileSystem: (root: vscode.Uri) => IFileSystem,
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
    const fileSystem = createFileSystem(libraryRoot);
    await fileSystem.ensureDir(libraryRoot.fsPath);
    await ensureLibraryStructure(libraryRoot, fileSystem);
    await persistLibraryRoot(context, libraryRoot);
    return libraryRoot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf: Failed to create library at ${libraryRoot.fsPath}: ${message}`);
    return undefined;
  }
}
