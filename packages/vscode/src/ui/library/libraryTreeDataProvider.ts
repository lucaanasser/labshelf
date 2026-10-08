/**
 * Provides the VS Code tree view for the LabShelf library: an "All Papers" entry plus the collection folders under papers/. Every row opens in the list panel, shows its paper count, and accepts PDF drops and folder drags.
 *
 * @depends @labshelf/core, ui/library/folderNavigation.ts, ui/library/collectionFolders.ts
 * @dependents ui/library/index.ts, extension.ts
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EventBus } from '@labshelf/core';
import { readCollectionFolders } from './collectionFolders.js';
import { countPapersUnder, rootNode } from './folderNavigation.js';
import type { LibraryNode } from './folderNavigation.js';

export type { LibraryNode } from './folderNavigation.js';

const ROOT_ITEM_ID = 'labshelf:all-papers';
const REFRESH_DEBOUNCE_MS = 60;

export class LibraryTreeDataProvider implements vscode.TreeDataProvider<LibraryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _papersRoot: vscode.Uri | null;
  private _paperPathSource: (() => Promise<string[]>) | null = null;
  private _paperPaths: Promise<string[]> | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(papersRoot: vscode.Uri | null, eventBus: EventBus) {
    this._papersRoot = papersRoot;
    // A folder move emits one paper:updated per paper, so event refreshes are coalesced.
    const refresh = (): void => this._scheduleRefresh();
    eventBus.on('paper:added', refresh);
    eventBus.on('paper:updated', refresh);
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
   * Registers where the provider reads stored paper paths from, used for the per-folder counts.
   * @usedBy extension.ts
   * @returns void
   */
  setPaperPathSource(source: () => Promise<string[]>): void {
    this._paperPathSource = source;
  }

  /**
   * Drops cached counts and fires onDidChangeTreeData so VS Code re-reads the tree.
   * @usedBy extension.ts (and eventBus listeners, debounced)
   * @returns void
   */
  refresh(): void {
    this._paperPaths = null;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the node for papers/ itself, or null while no library is configured.
   * @usedBy extension.ts
   * @returns the root LibraryNode or null
   */
  rootNode(): LibraryNode | null {
    return this._papersRoot ? rootNode(this._papersRoot.fsPath) : null;
  }

  /**
   * Returns the VS Code TreeItem for a node. Every row, not just leaves, opens in the list panel on click.
   * @usedBy vscode TreeView API
   * @returns A vscode.TreeItem configured for the given node.
   */
  async getTreeItem(node: LibraryNode): Promise<vscode.TreeItem> {
    const hasChildren = !node.isRoot && (await readCollectionFolders(node.dirPath)).length > 0;
    const item = new vscode.TreeItem(
      node.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.isRoot ? ROOT_ITEM_ID : node.dirPath;
    item.iconPath = node.isRoot ? new vscode.ThemeIcon('library') : vscode.ThemeIcon.Folder;
    item.contextValue = node.isRoot ? 'labshelfRoot' : 'labshelfFolder';
    item.tooltip = node.dirPath;
    if (!node.isRoot) {
      item.resourceUri = vscode.Uri.file(node.dirPath);
    }

    const count = countPapersUnder(await this._readPaperPaths(), node.dirPath, path.sep);
    if (count > 0) {
      item.description = String(count);
    }

    item.command = { command: 'labshelf.openListTab', title: 'Open', arguments: [node] };
    return item;
  }

  /**
   * Returns the child folders of a node. The top level is "All Papers" followed by the folders directly under papers/.
   * @usedBy vscode TreeView API
   * @returns A promise resolving to an array of LibraryNode objects.
   */
  async getChildren(node?: LibraryNode): Promise<LibraryNode[]> {
    if (node?.isRoot) {
      return [];
    }
    if (node) {
      return readCollectionFolders(node.dirPath);
    }
    const root = this.rootNode();
    if (!root) {
      return [];
    }
    return [root, ...(await readCollectionFolders(root.dirPath))];
  }

  /**
   * Returns the parent LibraryNode for a given node, or null when the node is at the top level.
   * @usedBy vscode TreeView API (reveal)
   * @returns The parent LibraryNode, or null.
   */
  getParent(node: LibraryNode): vscode.ProviderResult<LibraryNode> {
    const root = this._papersRoot?.fsPath;
    if (!root || node.isRoot) {
      return null;
    }
    const parent = path.dirname(node.dirPath);
    if (parent === root || !parent.startsWith(root + path.sep)) {
      return null;
    }
    return { label: path.basename(parent), dirPath: parent };
  }

  private _scheduleRefresh(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // One read per refresh cycle, shared by every getTreeItem call. Count failures never block rendering.
  private _readPaperPaths(): Promise<string[]> {
    if (!this._paperPaths) {
      const source = this._paperPathSource;
      this._paperPaths = source ? source().catch(() => []) : Promise.resolve([]);
    }
    return this._paperPaths;
  }
}

export default LibraryTreeDataProvider;

// text/uri-list carries OS file drops (PDF import). The tree mime carries folders
// dragged inside this tree; its name is fixed by VS Code from the view id.
const URI_LIST_MIME = 'text/uri-list';
const TREE_MIME = 'application/vnd.code.tree.labshelf.library';

export class LibraryDragAndDropController implements vscode.TreeDragAndDropController<LibraryNode> {
  readonly dropMimeTypes = [URI_LIST_MIME, TREE_MIME];
  readonly dragMimeTypes = [TREE_MIME];

  constructor(
    private readonly onFileDrop: (uris: vscode.Uri[], targetDir: string | undefined) => Promise<void>,
    private readonly onFolderMove?: (sourceDirs: string[], targetDir: string | undefined) => Promise<void>,
  ) {}

  /**
   * Puts the dragged folders on the transfer. "All Papers" is not a real folder and cannot be dragged.
   * @usedBy vscode TreeDragAndDropController API
   * @returns void
   */
  handleDrag(source: readonly LibraryNode[], dataTransfer: vscode.DataTransfer): void {
    const dirs = source.filter((n) => !n.isRoot).map((n) => n.dirPath);
    if (dirs.length > 0) {
      dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(dirs));
    }
  }

  /**
   * Routes a drop: folders dragged within the tree are moved, OS files are imported. A drop on "All Papers" or on the empty area targets papers/.
   * @usedBy vscode TreeDragAndDropController API
   * @returns void
   */
  async handleDrop(target: LibraryNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const targetDir = target?.dirPath;

    const dragged = dataTransfer.get(TREE_MIME)?.value as unknown;
    if (Array.isArray(dragged) && dragged.length > 0) {
      const dirs = dragged.filter((d): d is string => typeof d === 'string');
      if (dirs.length > 0 && this.onFolderMove) {
        await this.onFolderMove(dirs, targetDir);
      }
      return;
    }

    const item = dataTransfer.get(URI_LIST_MIME);
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
      await this.onFileDrop(uris, targetDir);
    }
  }
}
