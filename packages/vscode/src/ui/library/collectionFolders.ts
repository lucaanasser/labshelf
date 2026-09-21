/**
 * Reads collection folders from disk: the directories under papers/ that organize papers, as opposed to the folders that hold one paper each.
 *
 * @depends ui/library/folderNavigation.ts
 * @dependents ui/library/libraryTreeDataProvider.ts, ui/list/listWebviewPanel.ts
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LibraryNode } from './folderNavigation.js';

// A directory is treated as a single paper (not a collection) when it contains
// one of these marker files.
const PAPER_MARKERS = ['metadata.yaml', 'paper.pdf'];

async function isPaperFolder(dirPath: string): Promise<boolean> {
  for (const marker of PAPER_MARKERS) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dirPath, marker)));
      return true;
    } catch {
      // marker absent — keep checking
    }
  }
  return false;
}

/**
 * Lists the collection folders directly inside `dirPath`, sorted by name. Unreadable directories yield an empty list.
 * @usedBy ui/library/libraryTreeDataProvider.ts, ui/list/listWebviewPanel.ts
 * @returns the child collection folders as LibraryNode objects
 */
export async function readCollectionFolders(dirPath: string): Promise<LibraryNode[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
  } catch {
    return [];
  }

  const folders: LibraryNode[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory || name.startsWith('.')) {
      continue;
    }
    const childPath = path.join(dirPath, name);
    if (await isPaperFolder(childPath)) {
      continue;
    }
    folders.push({ label: name, dirPath: childPath });
  }

  folders.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return folders;
}

/**
 * Lists every collection folder under `rootDir` at any depth, parents before children.
 * @usedBy ui/list/listWebviewPanel.ts (move-to picker)
 * @returns a flat, depth-first list of collection folders
 */
export async function listAllCollectionFolders(rootDir: string): Promise<LibraryNode[]> {
  const all: LibraryNode[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const folder of await readCollectionFolders(dir)) {
      all.push(folder);
      await walk(folder.dirPath);
    }
  };
  await walk(rootDir);
  return all;
}
