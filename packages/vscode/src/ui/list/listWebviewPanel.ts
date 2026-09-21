/**
 * Manages the central editor tab that browses the library: any folder opens here, with breadcrumb and subfolder navigation, search, and paper organization, next to an inline detail sidebar.
 *
 * @depends ui/list/template.ts, ui/library/folderNavigation.ts, ui/library/collectionFolders.ts, core/paperService.ts, @labshelf/core
 * @dependents ui/list/index.ts, extension.ts
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isUnderDir } from '@labshelf/core';
import type { PaperService } from '../../core/paperService.js';
import type { ExtensionEventBus, PaperRecord } from '@labshelf/core';
import { listAllCollectionFolders, readCollectionFolders } from '../library/collectionFolders.js';
import { buildListState, rootNode } from '../library/folderNavigation.js';
import type { LibraryNode } from '../library/folderNavigation.js';
import { buildListPanelHtml } from './template.js';

const RELOAD_DEBOUNCE_MS = 60;
const PAPER_EVENTS = ['paper:added', 'paper:updated', 'paper:deleted'] as const;

export interface ListPanelDeps {
  extensionUri: vscode.Uri;
  paperService: PaperService;
  eventBus: ExtensionEventBus;
  /** Absolute path of papers/, or null while no library is configured. */
  getPapersRoot: () => string | null;
  /** Called whenever the panel shows a different folder, so the sidebar tree can follow. */
  onDidNavigate?: (folder: LibraryNode) => void;
}

export class ListWebviewPanel {
  public static currentPanel: ListWebviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _deps: ListPanelDeps;
  private _disposables: vscode.Disposable[] = [];
  private _folder: LibraryNode | undefined;
  private _webviewReady = false;
  private _disposed = false;
  private _loadSeq = 0;
  private _lastNotified: string | undefined;
  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onPaperEvent = (): void => this._scheduleReload();

  /**
   * Reveals the existing list panel if one is open, or creates a new one, and navigates it to the given folder (papers/ when omitted).
   * @usedBy extension.ts
   * @returns void
   */
  public static createOrShow(deps: ListPanelDeps, folder?: LibraryNode): void {
    if (ListWebviewPanel.currentPanel) {
      ListWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      void ListWebviewPanel.currentPanel.navigateTo(folder);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'labshelfList',
      folder?.label ?? 'LabShelf',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [deps.extensionUri],
      },
    );

    ListWebviewPanel.currentPanel = new ListWebviewPanel(panel, deps, folder);
  }

  private constructor(panel: vscode.WebviewPanel, deps: ListPanelDeps, folder?: LibraryNode) {
    this._panel = panel;
    this._deps = deps;
    this._folder = folder;

    // The shell is rendered once; folder changes and paper events arrive as
    // state messages so selection, scroll, and the search box survive them.
    this._panel.webview.html = buildListPanelHtml(this._panel.webview);

    this._panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    for (const event of PAPER_EVENTS) {
      deps.eventBus.on(event, this._onPaperEvent);
    }
  }

  /**
   * The folder currently shown, used to keep the sidebar tree selection in sync.
   * @usedBy extension.ts
   * @returns the current LibraryNode, or undefined before the first load
   */
  public get currentFolder(): LibraryNode | undefined {
    return this._folder;
  }

  /**
   * Shows the given folder; anything missing or outside papers/ falls back to the library root.
   * @usedBy extension.ts, ui/list/listWebviewPanel.ts (webview navigate messages)
   * @returns void
   */
  public async navigateTo(folder?: LibraryNode): Promise<void> {
    this._folder = folder;
    await this._pushState();
  }

  /**
   * Re-reads the current folder from disk and the index; called after folders are created, renamed, moved, or deleted.
   * @usedBy extension.ts
   * @returns void
   */
  public async refresh(): Promise<void> {
    await this._pushState();
  }

  /**
   * Keeps the panel on the same folder after it (or one of its ancestors) moved from oldDir to newDir.
   * @usedBy extension.ts
   * @returns void
   */
  public async followFolderMove(oldDir: string, newDir: string): Promise<void> {
    const current = this._folder;
    if (current && !current.isRoot && isUnderDir(current.dirPath, oldDir, path.sep)) {
      const dirPath = newDir + current.dirPath.slice(oldDir.length);
      this._folder = { label: path.basename(dirPath), dirPath };
    }
    await this._pushState();
  }

  private _scheduleReload(): void {
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      void this._pushState();
    }, RELOAD_DEBOUNCE_MS);
  }

  // Resolves the folder to show, guarding against deleted folders and paths outside papers/.
  private async _resolveFolder(root: string): Promise<LibraryNode> {
    const wanted = this._folder;
    if (!wanted || wanted.isRoot || wanted.dirPath === root || !isUnderDir(wanted.dirPath, root, path.sep)) {
      return rootNode(root);
    }
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(wanted.dirPath));
      if (stat.type & vscode.FileType.Directory) {
        return { label: path.basename(wanted.dirPath), dirPath: wanted.dirPath };
      }
    } catch {
      // folder no longer exists — fall through to the root
    }
    return rootNode(root);
  }

  private async _pushState(): Promise<void> {
    const root = this._deps.getPapersRoot();
    if (!root || !this._webviewReady) { return; }

    const seq = ++this._loadSeq;
    const folder = await this._resolveFolder(root);
    let papers: PaperRecord[] = [];
    try {
      papers = await this._deps.paperService.listPapers();
    } catch {
      // A failed index read keeps the panel usable and empty rather than broken.
    }
    const subfolders = await readCollectionFolders(folder.dirPath);
    if (seq !== this._loadSeq) { return; }

    this._folder = folder;
    this._panel.title = folder.isRoot ? 'LabShelf' : folder.label;
    await this._panel.webview.postMessage(buildListState(papers, folder, root, subfolders, path.sep));
    if (this._lastNotified !== folder.dirPath) {
      this._lastNotified = folder.dirPath;
      this._deps.onDidNavigate?.(folder);
    }
  }

  // Accepts only directories inside papers/ from webview messages.
  private _safeDir(value: unknown): string | undefined {
    const root = this._deps.getPapersRoot();
    if (typeof value !== 'string' || !root || !isUnderDir(value, root, path.sep)) {
      return undefined;
    }
    return value;
  }

  private _nodeFor(dirPath: string): LibraryNode {
    const root = this._deps.getPapersRoot();
    return dirPath === root ? rootNode(dirPath) : { label: path.basename(dirPath), dirPath };
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    const paperId = msg['paperId'] as string | undefined;
    switch (msg['command']) {
      case 'ready': {
        this._webviewReady = true;
        await this._pushState();
        break;
      }
      case 'navigate': {
        const dir = this._safeDir(msg['dirPath']);
        if (dir) { await this.navigateTo(this._nodeFor(dir)); }
        break;
      }
      case 'openPdf': {
        if (paperId) {
          await vscode.commands.executeCommand('labshelf.openPdfViewer', paperId);
        }
        break;
      }
      case 'openFolder': {
        const paper = await this._findPaper(paperId);
        if (paper) {
          await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(paper.path));
        }
        break;
      }
      case 'copyCitation': {
        const paper = await this._findPaper(paperId);
        if (paper) {
          await vscode.env.clipboard.writeText(paper.citeKey);
          vscode.window.showInformationMessage(`Copied: ${paper.citeKey}`);
        }
        break;
      }
      case 'updateStatus': {
        const status = msg['status'] as PaperRecord['status'];
        if (paperId && status) {
          await this._deps.paperService.updatePaperStatus(paperId, status);
        }
        break;
      }
      case 'deletePaper': {
        if (!paperId) { break; }
        const paper = await this._findPaper(paperId);
        if (!paper) { break; }
        const choice = await vscode.window.showWarningMessage(
          `Remove "${paper.title}" from library?`,
          { modal: true },
          'Remove only',
          'Remove + delete files',
        );
        if (!choice) { break; }
        await this._deps.paperService.deletePaper(paperId, choice === 'Remove + delete files');
        break;
      }
      case 'addPaper': {
        // Imports land in the folder being viewed, not at the library root.
        await vscode.commands.executeCommand('labshelf.addPaperHere', this._folder);
        break;
      }
      case 'newFolder': {
        await vscode.commands.executeCommand('labshelf.newFolder', this._folder);
        break;
      }
      case 'movePapers': {
        const target = this._safeDir(msg['targetDir']);
        if (target) { await this._movePapers(toIds(msg['paperIds']), target); }
        break;
      }
      case 'pickMoveTarget': {
        await this._pickMoveTarget(toIds(msg['paperIds']));
        break;
      }
    }
  }

  private async _pickMoveTarget(paperIds: string[]): Promise<void> {
    const root = this._deps.getPapersRoot();
    if (!root || paperIds.length === 0) { return; }

    const folders = [rootNode(root), ...(await listAllCollectionFolders(root))];
    const picked = await vscode.window.showQuickPick(
      folders.map((f) => ({
        label: f.isRoot ? f.label : path.relative(root, f.dirPath).split(path.sep).join(' / '),
        dirPath: f.dirPath,
      })),
      { placeHolder: `Move ${paperIds.length === 1 ? 'paper' : `${paperIds.length} papers`} to…`, matchOnDescription: true },
    );
    if (picked) { await this._movePapers(paperIds, picked.dirPath); }
  }

  private async _movePapers(paperIds: string[], targetDir: string): Promise<void> {
    if (paperIds.length === 0) { return; }
    const result = await this._deps.paperService.movePapers(paperIds, targetDir);
    if (result.failed.length > 0) {
      const first = result.failed[0]?.error ?? 'unknown error';
      vscode.window.showErrorMessage(`LabShelf: ${result.moved.length} moved, ${result.failed.length} failed — ${first}`);
    } else if (result.moved.length > 0) {
      const where = this._nodeFor(targetDir).label;
      vscode.window.setStatusBarMessage(`LabShelf: ${result.moved.length} paper(s) moved to ${where}`, 3000);
    }
  }

  private async _findPaper(id?: string): Promise<PaperRecord | undefined> {
    if (!id) { return undefined; }
    return (await this._deps.paperService.listPapers()).find(p => p.id === id);
  }

  /**
   * Clears the static panel reference, detaches event listeners, and disposes the webview panel.
   * @usedBy ui/list/listWebviewPanel.ts (self, on panel dispose event)
   * @returns void
   */
  public dispose(): void {
    // panel.dispose() below re-enters through onDidDispose.
    if (this._disposed) { return; }
    this._disposed = true;
    if (ListWebviewPanel.currentPanel === this) { ListWebviewPanel.currentPanel = undefined; }
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    for (const event of PAPER_EVENTS) {
      this._deps.eventBus.off(event, this._onPaperEvent);
    }
    this._panel.dispose();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
  }
}

function toIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export default ListWebviewPanel;
