/**
 * Persists, resolves, and sets up the central LabShelf library directory using VS Code globalState, mirrored in the
 * config file shared with the terminal app so both open the same library.
 */
import * as vscode from "vscode";

import { libraryLayout, type IFileSystem, type ILogger } from "@labshelf/core";
import { readSharedLibraryRoot, sharedConfigPath, updateSharedConfig } from "@labshelf/core/node";

const LIBRARY_ROOT_KEY = "labshelf.libraryRoot";

/**
 * Reads the stored library root path from globalState and validates that it still exists on disk.
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
 * @returns void
 */
export async function persistLibraryRoot(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  await context.globalState.update(LIBRARY_ROOT_KEY, uri.fsPath);
}

/**
 * Records the library root in the shared config for the terminal app. Every activated library goes through here, so
 * libraries configured before the shared file existed are recorded too. A failure only costs the terminal its default,
 * so it is logged and VS Code keeps working from globalState.
 * @returns void
 */
export async function mirrorLibraryRoot(uri: vscode.Uri, logger: ILogger): Promise<void> {
  try {
    await updateSharedConfig({ libraryRoot: uri.fsPath }, undefined, logger);
  } catch (error) {
    await logger.error("storage/libraryLocation", error, { file: sharedConfigPath(), libraryRoot: uri.fsPath });
  }
}

/**
 * Creates all required LabShelf subdirectories under root if they do not already exist.
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
