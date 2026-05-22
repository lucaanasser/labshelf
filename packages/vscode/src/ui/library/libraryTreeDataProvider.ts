/**
 * Provides the VS Code tree view for the LabShelf library by reading collection folders under the papers/ directory, and handles drag-and-drop PDF imports.
 *
 * @depends @labshelf/core
 * @dependents ui/library/index.ts, extension.ts
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionEventBus } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. Paper folders are not shown as nodes — their papers
// surface in the list panel when a collection folder is opened.
export interface LibraryNode {
  label: string;
  dirPath: string;
}

// A directory is treated as a single paper (not a collection) when it contains
// one of these marker files.
const PAPER_MARKERS = ['metadata.yaml', 'paper.pdf'];

export class LibraryTreeDataProvider implements vscode.TreeDataProvider<LibraryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _papersRoot: vscode.Uri | null;

  constructor(papersRoot: vscode.Uri | null, eventBus: ExtensionEventBus) {
    this._papersRoot = papersRoot;
    const refresh = (): void => this.refresh();
    eventBus.on('paper:added', refresh);
    eventBus.on('paper:deleted', refresh);
  }

  /**
   * Updates the papers root URI and triggers a full tree refresh; called after workspace setup completes.
   * @usedBy extension.ts
   * @returns void
   */
  setPapersRoot(papersRoot: vscode.Uri): void {
    this._papersRoot = papersRoot;
    this.refresh();
  }

  /**
   * Fires the onDidChangeTreeData event to instruct VS Code to re-read the tree.
   * @usedBy extension.ts (via eventBus listeners)
   * @returns void
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the VS Code TreeItem representation of a library node, with expand state and open command.
   * @usedBy vscode TreeView API
   * @returns A vscode.TreeItem configured for the given collection folder node.
   */
  async getTreeItem(node: LibraryNode): Promise<vscode.TreeItem> {
    const subfolders = await this._readCollectionFolders(node.dirPath);
    const isLeaf = subfolders.length === 0;
    const item = new vscode.TreeItem(
      node.label,
      isLeaf ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = node.dirPath;
    item.resourceUri = vscode.Uri.file(node.dirPath);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'labshelfFolder';
    item.tooltip = node.dirPath;
    // Leaf folders hold papers — open them in the list panel. Folders with
    // subfolders are navigation-only and just expand on click.
    if (isLeaf) {
      item.command = {
        command: 'labshelf.openListTab',
        title: 'Open',
        arguments: [node],
      };
    }
    return item;
  }

  /**
   * Returns the child collection folder nodes for the given node, or the top-level folders when called without an argument.
   * @usedBy vscode TreeView API
   * @returns A thenable resolving to an array of LibraryNode objects.
   */
  getChildren(node?: LibraryNode): Thenable<LibraryNode[]> {
    const dir = node ? node.dirPath : this._papersRoot?.fsPath;
    if (!dir) {
      return Promise.resolve([]);
    }
    return this._readCollectionFolders(dir);
  }

  /**
   * Returns the parent LibraryNode for a given node, or null when the node is at the root level.
   * @usedBy vscode TreeView API (reveal)
   * @returns The parent LibraryNode, or null.
   */
  getParent(node: LibraryNode): vscode.ProviderResult<LibraryNode> {
    const root = this._papersRoot?.fsPath;
    if (!root) {
      return null;
    }
    const parent = path.dirname(node.dirPath);
    if (parent === root || !parent.startsWith(root + path.sep)) {
      return null;
    }
    return { label: path.basename(parent), dirPath: parent };
  }

  // Subdirectories of `dirPath` that are collection folders, not paper folders.
  private async _readCollectionFolders(dirPath: string): Promise<LibraryNode[]> {
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
      if (await this._isPaperFolder(childPath)) {
        continue;
      }
      folders.push({ label: name, dirPath: childPath });
    }

    folders.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return folders;
  }

  private async _isPaperFolder(dirPath: string): Promise<boolean> {
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
}

export default LibraryTreeDataProvider;

// Accepts OS file drops onto a folder (or the empty tree area) and routes them
// to the batch import callback wired in extension.ts, scoped to the drop target.
export class LibraryDragAndDropController implements vscode.TreeDragAndDropController<LibraryNode> {
  readonly dropMimeTypes = ['text/uri-list'];
  readonly dragMimeTypes: string[] = [];

  constructor(
    private readonly onFileDrop: (uris: vscode.Uri[], targetDir: string | undefined) => Promise<void>,
  ) {}

  /**
   * Handles a drag-and-drop file event from the OS, parsing dropped URIs and routing them to the import callback.
   * @usedBy vscode TreeDragAndDropController API
   * @returns void
   */
  async handleDrop(target: LibraryNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get('text/uri-list');
    if (!item) {
      return;
    }

    const raw = await item.asString();
    const uris = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .flatMap((line) => {
        try {
          return [vscode.Uri.parse(line, true)];
        } catch {
          return [];
        }
      })
      .filter((u) => u.scheme === 'file');

    if (uris.length > 0) {
      await this.onFileDrop(uris, target?.dirPath);
    }
  }

  handleDrag(): void {}
}
