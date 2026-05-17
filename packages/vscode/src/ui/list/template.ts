/**
 * Generates the full HTML/CSS/JS document for the paper list webview panel, including the inline detail sidebar and all interactive controls.
 *
 * @depends ui/library/libraryTreeDataProvider.ts, core/types.ts, ui/list/template.css.ts, ui/list/template.icons.ts, ui/list/template.script.ts
 * @dependents ui/list/listWebviewPanel.ts, ui/list/index.ts
 */
import * as vscode from 'vscode';
import type { LibraryNode } from '../library/libraryTreeDataProvider.js';
import type { PaperRecord } from '../../core/types.js';
import { listPanelCss } from './template.css.js';
import { secIcon } from './template.icons.js';
import { buildListScript } from './template.script.js';

/**
 * Builds and returns the complete HTML string for the paper list webview, embedding paper data as JSON and all inline styles and scripts.
 * @usedBy ui/list/listWebviewPanel.ts
 * @returns A full HTML document string ready to assign to webview.html.
 */
export function buildListPanelHtml(webview: vscode.Webview, collection: LibraryNode | undefined, papers: PaperRecord[]): string {
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
<style>${listPanelCss()}</style>
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
      <div></div><div></div>
      <div>Title</div><div>Creator</div><div>Status</div>
      <div title="Attachments" style="display:flex;align-items:center;justify-content:center">${secIcon('paperclip')}</div>
    </div>
    <div class="paper-list" id="paperList"></div>
  </div>
  <div class="detail-resizer" id="detailResizer" title="Drag to resize"></div>
  <div class="detail-pane" id="detailPane">
    <div class="detail-placeholder">Select a paper to see details</div>
  </div>
</div>
${buildListScript(n, papersJson)}
</body>
</html>`;
}

/**
 * Returns a minimal loading placeholder HTML string shown while the paper list is being fetched.
 * @usedBy ui/list/listWebviewPanel.ts
 * @returns A short HTML document string with a "Loading…" message.
 */
export function loadingHtml(): string {
  return '<!doctype html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;">Loading…</body></html>';
}

// ─── private helpers ───────────────────────────────────────────────────────────

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
