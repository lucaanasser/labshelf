/**
 * Generates the static HTML shell for the list webview panel. Folder contents arrive afterwards as state messages, so the shell is rendered only once per panel.
 *
 * @depends ui/list/template.css.ts, ui/list/template.icons.ts, ui/list/template.script.ts
 * @dependents ui/list/listWebviewPanel.ts, ui/list/index.ts
 */
import * as vscode from 'vscode';
import { listPanelCss } from './template.css.js';
import { secIcon } from './template.icons.js';
import { buildListScript } from './template.script.js';

/**
 * Builds the complete HTML shell for the list webview: collection header with search and actions, the status and subfolder filter bar, sortable column heads, the paper list, and the detail pane.
 * @usedBy ui/list/listWebviewPanel.ts
 * @returns A full HTML document string ready to assign to webview.html.
 */
export function buildListPanelHtml(webview: vscode.Webview): string {
  const n = nonce();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>LabShelf</title>
<style>${listPanelCss()}</style>
</head>
<body>
<div class="app">
  <div class="list-pane">
    <div class="list-header">
      <nav class="breadcrumb" id="breadcrumb" aria-label="Collection path"></nav>
      <div class="search-box">
        <span class="search-icon">${secIcon('search')}</span>
        <input id="searchInput" type="text" placeholder="Search title, author, year, keyword  ( / )" spellcheck="false" autocomplete="off"/>
        <button class="search-clear" id="searchClear" title="Clear search (Esc)">${secIcon('x')}</button>
      </div>
      <button class="list-icon-btn" id="includeSubBtn" title="Show papers from subfolders">${secIcon('layers')}</button>
      <button class="list-icon-btn" id="newFolderBtn" title="New subfolder">${secIcon('folder-plus')}</button>
      <button class="list-add-btn" id="addPaperBtn" title="Add PDF or folder here">+ Add</button>
      <button class="list-icon-btn" id="toggleDetailBtn" title="Toggle details panel">${secIcon('panel-right')}</button>
    </div>
    <div class="filter-bar">
      <div class="status-filters" id="statusFilters" role="tablist" aria-label="Reading status"></div>
      <div class="sub-strip" id="subStrip" aria-label="Subfolders"></div>
    </div>
    <div class="col-heads" id="colHeads">
      <div></div><div></div>
      <div class="col-head sortable" data-sort="title">Title<span class="sort-ind">${secIcon('chevron-down')}</span></div>
      <div class="col-head sortable" data-sort="creator">Creator<span class="sort-ind">${secIcon('chevron-down')}</span></div>
      <div class="col-head sortable" data-sort="year">Year<span class="sort-ind">${secIcon('chevron-down')}</span></div>
      <div class="col-head sortable col-pub" data-sort="publication">Publication<span class="sort-ind">${secIcon('chevron-down')}</span></div>
      <div class="col-head sortable" data-sort="status">Status<span class="sort-ind">${secIcon('chevron-down')}</span></div>
    </div>
    <div class="paper-list" id="paperList" tabindex="0"><div class="detail-placeholder">Loading…</div></div>
  </div>
  <div class="detail-resizer" id="detailResizer" title="Drag to resize"></div>
  <div class="detail-pane" id="detailPane">
    <div class="detail-placeholder">Select a paper to see details</div>
  </div>
</div>
${buildListScript(n)}
</body>
</html>`;
}

// ─── private helpers ───────────────────────────────────────────────────────────

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
