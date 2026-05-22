/**
 * Manages the central editor tab that displays the paper list for a selected collection folder with an inline detail sidebar, in a Zotero-style split layout.
 *
 * @depends ui/list/template.ts, ui/library/libraryTreeDataProvider.ts, core/paperService.ts, @labshelf/core
 * @dependents ui/list/index.ts, extension.ts
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PaperService } from '../../core/paperService.js';
import type { ExtensionEventBus, PaperRecord } from '@labshelf/core';
import type { LibraryNode } from '../library/libraryTreeDataProvider.js';
import { buildListPanelHtml, loadingHtml } from './template.js';

export class ListWebviewPanel {
  public static currentPanel: ListWebviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentCollection: LibraryNode | undefined = undefined;
  private _paperService: PaperService;

  /**
   * Reveals the existing list panel if one is open, or creates a new one and loads the given collection.
   * @usedBy extension.ts, commands/registerCommands.ts
   * @returns void
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    paperService: PaperService,
    eventBus: ExtensionEventBus,
    collection?: LibraryNode,
  ): void {
    if (ListWebviewPanel.currentPanel) {
      ListWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      ListWebviewPanel.currentPanel._loadCollection(collection);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'labshelfList',
      collection?.label ?? 'LabShelf',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    ListWebviewPanel.currentPanel = new ListWebviewPanel(panel, paperService, eventBus, collection);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    paperService: PaperService,
    eventBus: ExtensionEventBus,
    collection?: LibraryNode,
  ) {
    this._panel = panel;
    this._paperService = paperService;

    this._panel.webview.html = loadingHtml();

    this._panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    const reload = () => this._loadCollection(this._currentCollection);
    eventBus.on('paper:added', reload);
    eventBus.on('paper:updated', reload);
    eventBus.on('paper:deleted', reload);

    this._loadCollection(collection);
  }

  private async _loadCollection(collection?: LibraryNode): Promise<void> {
    this._currentCollection = collection;
    if (collection) { this._panel.title = collection.label; }

    const all = await this._paperService.listPapers();
    const papers = filterForFolder(all, collection);
    this._panel.webview.html = buildListPanelHtml(this._panel.webview, collection, papers);
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    const paperId = msg['paperId'] as string | undefined;
    switch (msg['command']) {
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
          await this._paperService.updatePaperStatus(paperId, status);
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
        await this._paperService.deletePaper(paperId, choice === 'Remove + delete files');
        break;
      }
      case 'addPaper': {
        await vscode.commands.executeCommand('labshelf.addPaper');
        break;
      }
    }
  }

  private async _findPaper(id?: string): Promise<PaperRecord | undefined> {
    if (!id) { return undefined; }
    return (await this._paperService.listPapers()).find(p => p.id === id);
  }

  /**
   * Clears the static panel reference, disposes the webview panel, and cleans up all disposables.
   * @usedBy ui/list/listWebviewPanel.ts (self, on panel dispose event)
   * @returns void
   */
  public dispose(): void {
    ListWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Papers stored anywhere under the selected folder (recursively).
function filterForFolder(papers: PaperRecord[], folder?: LibraryNode): PaperRecord[] {
  if (!folder) { return papers; }
  const prefix = folder.dirPath + path.sep;
  return papers.filter(p => p.path === folder.dirPath || p.path.startsWith(prefix));
}

export default ListWebviewPanel;
