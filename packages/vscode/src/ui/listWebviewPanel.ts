/**
 * Module: List Webview Panel
 * Responsibility: Central editor tab showing the paper list for a selected folder,
 *   with an inline details sidebar — Zotero-style split layout.
 * Dependencies: vscode, PaperService, ExtensionEventBus, LibraryNode
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { PaperService } from '../core/paperService.js';
import type { ExtensionEventBus } from '../core/eventBus.js';
import type { LibraryNode } from './libraryTreeDataProvider.js';
import type { PaperRecord } from '../core/types.js';

export class ListWebviewPanel {
  public static currentPanel: ListWebviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _currentCollection: LibraryNode | undefined = undefined;
  private _paperService: PaperService;

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
    this._panel.webview.html = buildHtml(this._panel.webview, collection, papers);
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

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loadingHtml(): string {
  return '<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;">Loading…</body></html>';
}

function secIcon(name: string): string {
  const c = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  switch (name) {
    // Native VSCode tree twistie — exact codicon chevron paths (filled, 16×16).
    case 'chevron-down':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.62-.618 4.356 4.357z"/></svg>`;
    case 'chevron-right':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg>`;
    case 'book':
      return `<svg ${c}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
    case 'info':
      return `<svg ${c}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="8" stroke-width="2.5"/><line x1="12" y1="11" x2="12" y2="16"/></svg>`;
    case 'file-text':
      return `<svg ${c}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>`;
    case 'paperclip':
      return `<svg ${c}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
    case 'file':
      return `<svg ${c}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
    case 'edit-2':
      return `<svg ${c}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    case 'tag':
      return `<svg ${c}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" stroke-width="2.5"/></svg>`;
    case 'git-merge':
      return `<svg ${c}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>`;
    case 'panel-right':
      return `<svg ${c}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
    default:
      return `<svg ${c}><circle cx="12" cy="12" r="8"/></svg>`;
  }
}

function buildHtml(webview: vscode.Webview, collection: LibraryNode | undefined, papers: PaperRecord[]): string {
  const n = nonce();
  const title = esc(collection?.label ?? 'LabShelf');
  const papersJson = JSON.stringify(papers);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size,13px);
  color:var(--vscode-editor-foreground);
  background:var(--vscode-editor-background);
  display:flex;flex-direction:column;
}
/* ── Layout ── */
.app{display:flex;flex:1;overflow:hidden}
/* ── List pane ── */
.list-pane{
  flex:1;display:flex;flex-direction:column;overflow:hidden;
  border-right:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));
  min-width:0;
}
.list-header{
  display:flex;align-items:center;gap:8px;
  padding:6px 12px;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));
  background:var(--vscode-sideBar-background,var(--vscode-editor-background));
  flex-shrink:0;
}
.list-header-title{font-weight:600;font-size:13px}
.list-header-count{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  border-radius:10px;padding:0 6px;
}
.list-header-spacer{flex:1}
.list-add-btn{
  padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  border:none;
}
.list-add-btn:hover{background:var(--vscode-button-hoverBackground)}
.col-heads{
  display:grid;
  grid-template-columns:28px 22px 1fr 170px 120px 28px;
  padding:3px 4px;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  user-select:none;flex-shrink:0;
  background:var(--vscode-sideBar-background,var(--vscode-editor-background));
}
.col-heads>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paper-list{flex:1;overflow-y:auto}
/* ── Paper rows ── */
.paper-row{cursor:pointer}
.paper-row-main{
  display:grid;
  grid-template-columns:28px 22px 1fr 170px 120px 28px;
  align-items:center;padding:5px 4px;gap:0;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.07));
}
.paper-row-main:hover{background:var(--vscode-list-hoverBackground)}
.paper-row.selected .paper-row-main{
  background:var(--vscode-list-activeSelectionBackground);
  color:var(--vscode-list-activeSelectionForeground);
}
.paper-row.selected .paper-row-main .col-meta{
  color:var(--vscode-list-activeSelectionForeground);
}
.paper-row-main>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.expand-btn{
  display:flex;align-items:center;justify-content:center;
  width:16px;height:16px;flex-shrink:0;
  color:var(--vscode-foreground);
  transition:transform .1s;
}
.expand-btn svg{width:16px;height:16px}
.expand-btn.collapsed{transform:rotate(-90deg)}
/* override the grid-cell padding/clip so the chevron renders full 16px */
.paper-row-main>.expand-btn{padding:0;overflow:visible}
.paper-type-icon{opacity:.7;display:flex;align-items:center}
.paper-type-icon svg{width:13px;height:13px}
.col-title{font-size:13px}
.col-meta{font-size:12px;color:var(--vscode-descriptionForeground)}
.col-attach{text-align:center;font-size:11px;color:var(--vscode-descriptionForeground)}
/* ── Children ── */
.paper-children{display:none;background:var(--vscode-editor-background)}
.paper-row.expanded .paper-children{display:block}
.child-row{
  display:grid;
  grid-template-columns:28px 22px 1fr 170px 120px 28px;
  align-items:center;padding:4px 4px;gap:0;
  padding-left:28px;
  font-size:12px;color:var(--vscode-descriptionForeground);
  cursor:pointer;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.04));
}
.child-row:hover{background:var(--vscode-list-hoverBackground);color:var(--vscode-foreground)}
.child-row>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── Status badges ── */
.badge{
  display:inline-block;padding:1px 6px;border-radius:8px;
  font-size:10px;font-weight:500;vertical-align:middle;
}
.badge-unread{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.badge-reading{background:var(--vscode-charts-yellow,#e5c07b);color:#1e1e1e}
.badge-done{background:var(--vscode-charts-green,#4ec994);color:#1e1e1e}
/* ── Empty state ── */
.empty-state{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:64px 24px;gap:10px;
  color:var(--vscode-descriptionForeground);
}
.empty-icon{opacity:.25;display:flex;justify-content:center}.empty-icon svg{width:44px;height:44px}
.empty-text{font-size:13px}
.empty-hint{font-size:11px;opacity:.6;margin-top:2px}
/* ── Detail pane ── */
.detail-resizer{
  width:5px;flex-shrink:0;cursor:col-resize;
  background:transparent;transition:background .1s;
}
.detail-resizer:hover,.detail-resizer.dragging{
  background:var(--vscode-sash-hoverBorder,var(--vscode-focusBorder));
}
.detail-pane{
  width:272px;min-width:220px;max-width:620px;flex-shrink:0;
  overflow-y:auto;
  background:var(--vscode-sideBar-background,var(--vscode-editor-background));
  display:flex;flex-direction:column;
  border-left:1px solid var(--vscode-sideBar-border,var(--vscode-panel-border,rgba(128,128,128,.2)));
}
body.detail-collapsed .detail-pane{display:none}
/* collapsed: keep a thin visible edge sticking out so it can be grabbed back */
body.detail-collapsed .detail-resizer{
  background:var(--vscode-sideBar-border,var(--vscode-panel-border,rgba(128,128,128,.35)));
}
body.detail-collapsed .detail-resizer:hover,
body.detail-collapsed .detail-resizer.dragging{
  background:var(--vscode-sash-hoverBorder,var(--vscode-focusBorder));
}
.detail-placeholder{
  padding:32px 16px;
  color:var(--vscode-descriptionForeground);
  font-size:12px;text-align:center;line-height:1.6;
}
.detail-paper-title{
  padding:12px 12px 10px;
  font-weight:600;font-size:13px;line-height:1.4;
  border-bottom:1px solid var(--vscode-sideBar-border,var(--vscode-panel-border,rgba(128,128,128,.2)));
}
/* ── Detail sections — native sidebar pane-header aesthetic ── */
.sec-head{
  display:flex;align-items:center;justify-content:space-between;
  height:22px;padding:0 12px 0 2px;cursor:pointer;user-select:none;
  font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));
  background:var(--vscode-sideBarSectionHeader-background,transparent);
}
.sec-head:hover{background:var(--vscode-list-hoverBackground)}
.sec-head-left{display:flex;align-items:center;gap:3px;min-width:0}
.sec-head-left>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sec-chevron{
  width:16px;height:16px;flex-shrink:0;
  display:inline-flex;align-items:center;justify-content:center;
  transition:transform .1s;
}
.sec-chevron svg{width:16px;height:16px}
.sec-chevron.collapsed{transform:rotate(-90deg)}
.sec-icon{width:14px;height:14px;display:inline-flex;flex-shrink:0;opacity:.85}
.sec-icon svg{width:14px;height:14px}
.sec-actions{display:flex;align-items:center;gap:2px}
.sec-btn{
  background:none;border:none;cursor:pointer;padding:1px 3px;
  color:var(--vscode-descriptionForeground);font-size:14px;line-height:1;border-radius:3px;
}
.sec-btn:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-foreground)}
.sec-body{padding:6px 12px 10px;font-size:12px}
.sec-body.hidden{display:none}
/* ── List header toolbar icon ── */
.list-icon-btn{
  display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;border:none;background:none;cursor:pointer;
  border-radius:4px;color:var(--vscode-foreground);opacity:.75;
}
.list-icon-btn:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}
.list-icon-btn svg{width:15px;height:15px}
.detail-field{margin-bottom:6px}
.detail-label{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:1px}
.detail-value{line-height:1.4}
.detail-abstract{line-height:1.5;color:var(--vscode-foreground);font-size:12px}
.detail-abstract-truncated{-webkit-line-clamp:4;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}
.attach-item{
  display:flex;align-items:center;gap:6px;padding:4px 0;
  cursor:pointer;border-radius:3px;
}
.attach-item:hover{text-decoration:underline;color:var(--vscode-textLink-foreground)}
.detail-action-row{
  display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;
  border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.1));
}
.action-btn{
  padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  border:none;
}
.action-btn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.action-btn.primary{
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
}
.action-btn.primary:hover{background:var(--vscode-button-hoverBackground)}
.mock-note{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.6;padding:4px 10px 6px}
</style>
</head>
<body>
<div class="app">
  <div class="list-pane">
    <div class="list-header">
      <span style="opacity:.6;display:inline-flex;width:15px;height:15px">${secIcon('book')}</span>
      <span class="list-header-title">${title}</span>
      <span class="list-header-count" id="paperCount"></span>
      <span class="list-header-spacer"></span>
      <button class="list-add-btn" id="addPaperBtn" title="Add PDF or folder">+ Add</button>
      <button class="list-icon-btn" id="toggleDetailBtn" title="Toggle details panel">${secIcon('panel-right')}</button>
    </div>
    <div class="col-heads">
      <div></div>
      <div></div>
      <div>Title</div>
      <div>Creator</div>
      <div>Status</div>
      <div title="Attachments" style="display:flex;align-items:center;justify-content:center">${secIcon('paperclip')}</div>
    </div>
    <div class="paper-list" id="paperList"></div>
  </div>
  <div class="detail-resizer" id="detailResizer" title="Drag to resize"></div>
  <div class="detail-pane" id="detailPane">
    <div class="detail-placeholder">Select a paper to see details</div>
  </div>
</div>

<script nonce="${n}">
(function(){
  const vscode = acquireVsCodeApi();
  const papers = ${papersJson};

  // ── render list ───────────────────────────────────────────────────────────
  const list = document.getElementById('paperList');
  const countEl = document.getElementById('paperCount');
  const detail = document.getElementById('detailPane');

  countEl.textContent = papers.length > 0 ? String(papers.length) : '';

  if (papers.length === 0) {
    list.innerHTML = \`<div class="empty-state">
      <div class="empty-icon">${secIcon('book')}</div>
      <div class="empty-text">No papers in this collection</div>
      <button class="list-add-btn" id="emptyAddBtn" style="margin-top:8px" title="Add PDF or folder">+ Add Paper</button>
      <div class="empty-hint">To import by drag and drop, drop PDF files onto a folder in the LabShelf tree in the sidebar — not onto this panel.</div>
    </div>\`;
    document.getElementById('emptyAddBtn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'addPaper' });
    });
  } else {
    papers.forEach(p => list.appendChild(buildRow(p)));
  }

  function fmt(authors) {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    const last = authors[authors.length - 1];
    return authors.length > 2
      ? authors[0].split(' ').pop() + ' et al.'
      : authors.map(a => a.split(' ').pop()).join(', ');
  }

  function field(label, value) {
    return \`<div class="detail-field"><div class="detail-label">\${esc(label)}</div><div class="detail-value">\${esc(value)}</div></div>\`;
  }

  function badgeHtml(status) {
    const labels = { unread: 'Unread', reading: 'Reading', done: 'Done' };
    return \`<span class="badge badge-\${esc(status)}">\${esc(labels[status] || status)}</span>\`;
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function buildRow(p) {
    const row = document.createElement('div');
    row.className = 'paper-row';
    row.dataset.id = p.id;

    const creator = fmt(p.authors);
    row.innerHTML = \`
      <div class="paper-row-main">
        <div class="expand-btn collapsed" title="Expand">${secIcon('chevron-down')}</div>
        <div class="paper-type-icon">${secIcon('file')}</div>
        <div class="col-title" title="\${esc(p.title)}">\${esc(p.title)}</div>
        <div class="col-meta" title="\${esc(creator)}">\${esc(creator)}</div>
        <div class="col-meta">\${badgeHtml(p.status)}</div>
        <div class="col-attach">1</div>
      </div>
      <div class="paper-children">
        <div class="child-row" data-action="openPdf" data-id="\${esc(p.id)}">
          <div></div>
          <div style="opacity:.6;display:flex;align-items:center">${secIcon('file')}</div>
          <div>PDF</div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      </div>
    \`;

    const main = row.querySelector('.paper-row-main');
    const expandBtn = row.querySelector('.expand-btn');

    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isExpanded = row.classList.toggle('expanded');
      expandBtn.classList.toggle('collapsed', !isExpanded);
    });

    main.addEventListener('click', () => selectPaper(p, row));

    row.querySelector('.child-row[data-action="openPdf"]').addEventListener('click', e => {
      e.stopPropagation();
      vscode.postMessage({ command: 'openPdf', paperId: p.id });
    });

    return row;
  }

  // ── selection + detail ────────────────────────────────────────────────────
  let selectedId = null;

  function selectPaper(p, row) {
    document.querySelectorAll('.paper-row.selected').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    selectedId = p.id;
    renderDetail(p);
  }

  function renderDetail(p) {
    const creator = fmt(p.authors);
    const attachCount = 1;
    detail.innerHTML = \`
      <div class="detail-paper-title">\${esc(p.title)}</div>

      <div class="detail-section">
        <div class="sec-head" data-sec="info">
          <div class="sec-head-left">
            <span class="sec-chevron">${secIcon('chevron-down')}</span>
            <span>Info</span>
          </div>
        </div>
        <div class="sec-body" id="sec-info">
          \${field('Item Type', 'Journal Article')}
          \${p.authors && p.authors.length ? p.authors.map(a => field('Author', a)).join('') : ''}
          \${p.journal ? field('Publication', p.journal) : ''}
          \${p.publisher ? field('Publisher', p.publisher) : ''}
          \${p.year ? field('Date', String(p.year)) : ''}
          \${p.volume ? field('Volume', p.volume) : ''}
          \${p.issue ? field('Issue', p.issue) : ''}
          \${p.pages ? field('Pages', p.pages) : ''}
          \${p.doi ? field('DOI', p.doi) : ''}
          \${p.issn ? field('ISSN', p.issn) : ''}
          \${p.url ? \`<div class="detail-field"><div class="detail-label">URL</div><div class="detail-value"><a href="\${esc(p.url)}" style="color:var(--vscode-textLink-foreground);word-break:break-all;font-size:11px">\${esc(p.url)}</a></div></div>\` : ''}
          \${p.language ? field('Language', p.language) : ''}
          <div class="detail-field"><div class="detail-label">Citation Key</div><div class="detail-value" style="font-family:monospace;font-size:11px">\${esc(p.citeKey)}</div></div>
          <div class="detail-field"><div class="detail-label">Status</div><div class="detail-value">\${badgeHtml(p.status)}</div></div>
        </div>
      </div>

      <div class="detail-section">
        <div class="sec-head" data-sec="abstract">
          <div class="sec-head-left">
            <span class="sec-chevron">${secIcon('chevron-down')}</span>
            <span>Abstract</span>
          </div>
        </div>
        <div class="sec-body" id="sec-abstract">
          \${p.summary
            ? \`<div class="detail-abstract detail-abstract-truncated">\${esc(p.summary)}</div>\`
            : \`<div style="color:var(--vscode-descriptionForeground);font-style:italic">No abstract available</div>\`
          }
        </div>
      </div>

      <div class="detail-section">
        <div class="sec-head" data-sec="attach">
          <div class="sec-head-left">
            <span class="sec-chevron">${secIcon('chevron-down')}</span>
            <span>\${attachCount} Attachment</span>
          </div>
        </div>
        <div class="sec-body" id="sec-attach">
          <div class="attach-item" data-action="openPdf" data-id="\${esc(p.id)}">
            <span class="sec-icon">${secIcon('file')}</span>
            <span>paper.pdf</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <div class="sec-head" data-sec="notes">
          <div class="sec-head-left">
            <span class="sec-chevron collapsed">${secIcon('chevron-down')}</span>
            <span>0 Notes</span>
          </div>
          <div class="sec-actions">
            <button class="sec-btn" title="Add note (coming soon)" disabled>+</button>
          </div>
        </div>
        <div class="sec-body hidden" id="sec-notes">
          <div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Notes not yet implemented</div>
        </div>
      </div>

      <div class="detail-section">
        <div class="sec-head" data-sec="tags">
          <div class="sec-head-left">
            <span class="sec-chevron collapsed">${secIcon('chevron-down')}</span>
            <span>0 Tags</span>
          </div>
          <div class="sec-actions">
            <button class="sec-btn" title="Add tag (coming soon)" disabled>+</button>
          </div>
        </div>
        <div class="sec-body hidden" id="sec-tags">
          <div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Tags not yet implemented</div>
        </div>
      </div>

      <div class="detail-section">
        <div class="sec-head" data-sec="related">
          <div class="sec-head-left">
            <span class="sec-chevron collapsed">${secIcon('chevron-down')}</span>
            <span>0 Related</span>
          </div>
        </div>
        <div class="sec-body hidden" id="sec-related">
          <div style="color:var(--vscode-descriptionForeground);font-style:italic;font-size:11px">Related papers not yet implemented</div>
        </div>
      </div>

      <div class="detail-action-row">
        <button class="action-btn primary" data-action="openPdf" data-id="\${esc(p.id)}">Open PDF</button>
        <button class="action-btn" data-action="copyCitation" data-id="\${esc(p.id)}">Copy Key</button>
        <button class="action-btn" data-action="openFolder" data-id="\${esc(p.id)}">Show Folder</button>
        <button class="action-btn" data-action="deletePaper" data-id="\${esc(p.id)}" style="color:var(--vscode-errorForeground)">Remove</button>
      </div>

      <div style="padding:8px 10px;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.1))">
        <div class="detail-label">Reading Status</div>
        <div style="display:flex;gap:4px;margin-top:4px">
          \${['unread','reading','done'].map(s =>
            \`<button class="action-btn\${p.status===s?' primary':''}" data-action="updateStatus" data-id="\${esc(p.id)}" data-status="\${s}">\${s.charAt(0).toUpperCase()+s.slice(1)}</button>\`
          ).join('')}
        </div>
      </div>
    \`;

    // wire section toggles
    detail.querySelectorAll('.sec-head').forEach(h => {
      h.addEventListener('click', () => {
        const secId = 'sec-' + h.dataset.sec;
        const body = document.getElementById(secId);
        const chev = h.querySelector('.sec-chevron');
        if (body) { body.classList.toggle('hidden'); }
        if (chev) { chev.classList.toggle('collapsed'); }
        h.classList.toggle('collapsed');
      });
    });

    // wire action buttons
    detail.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const action = el.dataset.action;
        const id = el.dataset.id;
        if (action === 'openPdf') { vscode.postMessage({ command: 'openPdf', paperId: id }); }
        if (action === 'openFolder') { vscode.postMessage({ command: 'openFolder', paperId: id }); }
        if (action === 'copyCitation') { vscode.postMessage({ command: 'copyCitation', paperId: id }); }
        if (action === 'updateStatus') { vscode.postMessage({ command: 'updateStatus', paperId: id, status: el.dataset.status }); }
        if (action === 'deletePaper') { vscode.postMessage({ command: 'deletePaper', paperId: id }); }
      });
    });
  }

  // ── add paper button ─────────────────────────────────────────────────────
  document.getElementById('addPaperBtn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'addPaper' });
  });

  // ── detail pane: collapse + resize (native-sidebar behaviour) ─────────────
  const detailPane = document.getElementById('detailPane');
  const detailResizer = document.getElementById('detailResizer');
  const toggleDetailBtn = document.getElementById('toggleDetailBtn');

  const persisted = vscode.getState() || {};
  if (persisted.detailWidth) { detailPane.style.width = persisted.detailWidth + 'px'; }
  if (persisted.detailCollapsed) { document.body.classList.add('detail-collapsed'); }

  function saveState(patch) {
    vscode.setState(Object.assign({}, vscode.getState() || {}, patch));
  }

  toggleDetailBtn?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('detail-collapsed');
    saveState({ detailCollapsed: collapsed });
  });

  // Drag the divider to resize; force it past the minimum and the pane snaps shut.
  const MIN_W = 220, MAX_W = 620, COLLAPSE_AT = 160;
  let resizing = false;
  detailResizer?.addEventListener('mousedown', e => {
    resizing = true;
    detailResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!resizing) return;
    const desired = window.innerWidth - e.clientX;
    if (desired < COLLAPSE_AT) {
      document.body.classList.add('detail-collapsed');
    } else {
      document.body.classList.remove('detail-collapsed');
      detailPane.style.width = Math.min(MAX_W, Math.max(MIN_W, desired)) + 'px';
    }
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    detailResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveState({
      detailWidth: parseInt(detailPane.style.width, 10) || MIN_W,
      detailCollapsed: document.body.classList.contains('detail-collapsed'),
    });
  });

  // Re-select previously selected paper after reload
  if (papers.length > 0 && selectedId) {
    const row = list.querySelector(\`[data-id="\${selectedId}"]\`);
    const paper = papers.find(p => p.id === selectedId);
    if (row && paper) { selectPaper(paper, row); }
  }
})();
</script>
</body>
</html>`;
}

export default ListWebviewPanel;
