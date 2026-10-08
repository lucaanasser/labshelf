/**
 * Inline CSS styles for the paper list webview panel.
 *
 * @depends none
 * @dependents ui/list/template.ts
 */

/** Returns the full inline CSS block for the list webview panel. */
export function listPanelCss(): string {
  return `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --cols:26px minmax(0,1fr) 140px 50px 170px 84px 80px;
  --border:var(--vscode-panel-border,rgba(128,128,128,.2));
  --border-soft:var(--vscode-panel-border,rgba(128,128,128,.12));
  --muted:var(--vscode-descriptionForeground);
  --side-bg:var(--vscode-sideBar-background,var(--vscode-editor-background));
  --hl-yellow:#f2c94c;--hl-green:#6fcf97;--hl-blue:#56a8f5;--hl-red:#eb5757;--hl-pink:#f178b6;
}
/* Narrow editors drop columns before the title gets squeezed: last read first, then the publication. */
@media (max-width:1080px){:root{--cols:26px minmax(0,1fr) 140px 50px 170px 80px}.col-read{display:none !important}}
@media (max-width:860px){:root{--cols:26px minmax(0,1fr) 120px 50px 80px}.col-pub{display:none !important}}
html,body{height:100%;overflow:hidden}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size,13px);
  color:var(--vscode-editor-foreground);
  background:var(--vscode-editor-background);
  display:flex;flex-direction:column;
}
button{font:inherit;color:inherit}
kbd{
  display:inline-block;min-width:16px;padding:0 4px;border-radius:3px;font:inherit;font-size:10px;line-height:15px;text-align:center;
  background:var(--vscode-keybindingLabel-background,rgba(128,128,128,.17));
  color:var(--vscode-keybindingLabel-foreground,inherit);
  border:1px solid var(--vscode-keybindingLabel-border,rgba(128,128,128,.3));
  border-bottom-color:var(--vscode-keybindingLabel-bottomBorder,rgba(128,128,128,.45));
}
.mono{font-family:var(--vscode-editor-font-family,monospace);font-size:11px}
.muted{color:var(--muted);font-style:italic;font-size:11px;line-height:1.5}
.muted-text{color:var(--muted)}
.tb-spacer{flex:1}
.spin{animation:ls-spin 1s linear infinite;display:inline-flex}
@keyframes ls-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
/* ── Layout ── */
.app{display:flex;flex:1;overflow:hidden}
.list-pane{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.list-header{
  display:flex;align-items:center;gap:6px;padding:5px 8px;flex-shrink:0;
  border-bottom:1px solid var(--border);background:var(--side-bg);
}
/* ── Breadcrumb ── */
.breadcrumb{display:flex;align-items:center;gap:1px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.crumb{
  display:inline-flex;align-items:center;gap:4px;flex-shrink:1;min-width:0;
  padding:2px 5px;border-radius:3px;border:1px solid transparent;
  background:none;color:var(--muted);font-size:12px;cursor:pointer;
}
.crumb>span{overflow:hidden;text-overflow:ellipsis}
.crumb svg{width:13px;height:13px;flex-shrink:0;opacity:.8}
.crumb:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-foreground)}
.crumb.current{color:var(--vscode-foreground);font-weight:600;font-size:13px;cursor:default;flex-shrink:0}
.crumb.current:hover{background:none}
.crumb-sep{display:inline-flex;width:14px;height:14px;flex-shrink:0;opacity:.5}
.crumb-sep svg{width:14px;height:14px}
/* ── Search ── */
.search-box{
  display:flex;align-items:center;gap:4px;width:280px;flex-shrink:1;min-width:110px;
  padding:0 4px 0 6px;height:24px;border-radius:3px;
  background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);
}
.search-box:focus-within{border-color:var(--vscode-focusBorder)}
.search-icon{display:inline-flex;width:13px;height:13px;opacity:.6;flex-shrink:0}
.search-icon svg{width:13px;height:13px}
.search-box input{flex:1;min-width:0;border:none;outline:none;background:none;color:var(--vscode-input-foreground);font:inherit;font-size:12px}
.search-box input::placeholder{color:var(--vscode-input-placeholderForeground)}
.search-clear{
  display:none;align-items:center;justify-content:center;width:16px;height:16px;
  border:none;background:none;cursor:pointer;color:var(--vscode-foreground);opacity:.6;border-radius:3px;
}
.search-clear svg{width:12px;height:12px}
.search-clear:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}
.search-box.has-query .search-clear{display:flex}
.list-header-count:empty{display:none}
.list-header-count{
  font-size:11px;flex-shrink:0;margin-left:4px;border-radius:10px;padding:0 6px;
  background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);
}
.list-add-btn{
  flex-shrink:0;padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer;border:none;
  background:var(--vscode-button-background);color:var(--vscode-button-foreground);
}
.list-add-btn:hover{background:var(--vscode-button-hoverBackground)}
.list-icon-btn{
  flex-shrink:0;display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;border:none;background:none;cursor:pointer;
  border-radius:4px;color:var(--vscode-foreground);opacity:.75;
}
.list-icon-btn:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}
.list-icon-btn svg{width:15px;height:15px}
.list-icon-btn.active{opacity:1;background:var(--vscode-toolbar-activeBackground,var(--vscode-toolbar-hoverBackground));color:var(--vscode-textLink-foreground)}
.list-icon-btn.hidden{display:none}
/* ── Filter bar: status tabs + subfolder chips ── */
.filter-bar{
  display:flex;align-items:center;gap:10px;flex-shrink:0;min-height:30px;
  padding:3px 10px;overflow:hidden;border-bottom:1px solid var(--border);
}
.status-filters{display:flex;align-items:center;gap:2px;flex-shrink:0}
.status-tab{
  display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:10px;
  border:none;background:none;cursor:pointer;font-size:11px;color:var(--muted);
}
.status-tab:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}
.status-tab.active{color:var(--vscode-foreground);background:var(--vscode-list-inactiveSelectionBackground);font-weight:600}
.status-tab .n{font-weight:400;opacity:.7}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--muted)}
.status-dot.s-unread{background:var(--vscode-charts-blue,#4aa5f0)}
.status-dot.s-reading{background:var(--vscode-charts-yellow,#e5c07b)}
.status-dot.s-done{background:var(--vscode-charts-green,#4ec994)}
.sub-strip{
  display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;
  padding-left:10px;border-left:1px solid var(--border);
}
.sub-strip::-webkit-scrollbar{display:none}
.sub-strip:empty{display:none}
.sub-chip{
  display:inline-flex;align-items:center;gap:5px;flex-shrink:0;padding:2px 8px;border-radius:3px;
  border:1px solid var(--border);background:none;cursor:pointer;font-size:11px;color:var(--vscode-foreground);
}
.sub-chip svg{width:12px;height:12px;opacity:.75}
.sub-chip .n{color:var(--muted)}
.sub-chip:hover{background:var(--vscode-list-hoverBackground);border-color:var(--vscode-focusBorder)}
/* While a paper is being dragged, every place it can be dropped lights up. */
body.dragging-papers .sub-chip,body.dragging-papers .crumb:not(.current){border-color:var(--vscode-focusBorder);border-style:dashed}
.drop-target{
  background:var(--vscode-list-dropBackground,rgba(83,89,93,.5)) !important;
  outline:1px dashed var(--vscode-focusBorder);outline-offset:-1px;
}
/* ── Column heads ── */
.col-heads{
  display:grid;grid-template-columns:var(--cols);padding:3px 4px;flex-shrink:0;user-select:none;
  border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);background:var(--side-bg);
}
.col-heads>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.col-head.sortable{cursor:pointer;display:flex;align-items:center;gap:2px}
.col-head.sortable:hover,.col-head.sorted{color:var(--vscode-foreground)}
.sort-ind{display:none;width:12px;height:12px;flex-shrink:0}
.sort-ind svg{width:12px;height:12px}
.col-head.sorted .sort-ind{display:inline-flex}
.col-head.sorted.asc .sort-ind{transform:rotate(180deg)}
/* ── Paper rows ── */
.paper-list{flex:1;overflow-y:auto}
.paper-list:focus{outline:none}
.paper-row{
  display:grid;grid-template-columns:var(--cols);align-items:center;padding:4px 4px;min-height:28px;cursor:pointer;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.07));
}
.paper-row>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paper-row:hover{background:var(--vscode-list-hoverBackground)}
.paper-row.cursor:not(.selected){background:var(--vscode-list-inactiveSelectionBackground)}
.paper-row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.paper-row.selected .col-meta,.paper-row.selected .match-hint,.paper-row.selected .row-mark{color:var(--vscode-list-activeSelectionForeground)}
.paper-list:focus .paper-row.cursor{outline:1px solid var(--vscode-list-focusOutline,var(--vscode-focusBorder));outline-offset:-1px}
.paper-row.dragging{opacity:.45}
.paper-type-icon{opacity:.7;display:flex;align-items:center;justify-content:center}
.paper-type-icon svg{width:14px;height:14px}
.col-title{font-size:13px}
.col-meta{font-size:12px;color:var(--muted)}
.title-cell{display:flex;align-items:center;gap:6px;min-width:0}
.title-cell>.title-text{overflow:hidden;text-overflow:ellipsis;min-width:0;flex-shrink:1}
.row-tag,.loc-chip,.match-hint{
  flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;
  font-size:10px;line-height:15px;padding:0 6px;border-radius:8px;
}
.row-tag{
  cursor:pointer;color:var(--vscode-foreground);
  background:var(--vscode-badge-background,rgba(128,128,128,.2));color:var(--vscode-badge-foreground,inherit);opacity:.85;
}
.row-tag:hover{opacity:1;outline:1px solid var(--vscode-focusBorder)}
.row-tag.more{cursor:default;outline:none}
.loc-chip{cursor:pointer;color:var(--muted);border:1px solid var(--border)}
.loc-chip:hover{color:var(--vscode-foreground);border-color:var(--vscode-focusBorder)}
.match-hint{color:var(--muted);font-style:italic;padding:0 2px}
.paper-row.selected .row-tag,.paper-row.selected .loc-chip{color:inherit;border-color:currentColor;background:rgba(255,255,255,.12)}
.row-marks{display:inline-flex;gap:6px;margin-left:auto;padding-left:6px;flex-shrink:0}
.row-mark{display:inline-flex;align-items:center;gap:2px;font-size:10px;color:var(--muted)}
.row-mark svg{width:12px;height:12px}
mark{background:var(--vscode-editor-findMatchHighlightBackground,rgba(234,92,0,.33));color:inherit;border-radius:2px}
/* ── Status badges ── */
.badge{
  border:none;cursor:pointer;display:inline-block;padding:1px 7px;border-radius:8px;
  font-size:10px;font-weight:500;vertical-align:middle;
}
.badge-unread{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.badge-reading{background:var(--vscode-charts-yellow,#e5c07b);color:#1e1e1e}
.badge-done{background:var(--vscode-charts-green,#4ec994);color:#1e1e1e}
.badge:hover{filter:brightness(1.12);outline:1px solid var(--vscode-focusBorder)}
/* ── Empty state ── */
.empty-state{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:64px 24px;gap:10px;color:var(--muted);
}
.empty-icon{opacity:.25;display:flex;justify-content:center}.empty-icon svg{width:44px;height:44px}
.empty-text{font-size:13px}
.empty-hint{font-size:11px;opacity:.6;margin-top:2px}
/* ── Detail pane ── */
.detail-resizer{width:4px;flex-shrink:0;cursor:col-resize;background:transparent;transition:background .1s;border-left:1px solid var(--border)}
.detail-resizer:hover,.detail-resizer.dragging{background:var(--vscode-sash-hoverBorder,var(--vscode-focusBorder))}
.detail-pane{
  position:relative;width:360px;min-width:260px;max-width:760px;flex-shrink:0;
  overflow-y:auto;overflow-x:hidden;background:var(--side-bg);display:flex;flex-direction:column;
}
body.detail-collapsed .detail-pane{display:none}
body.detail-collapsed .detail-resizer{background:var(--vscode-sideBar-border,var(--vscode-panel-border,rgba(128,128,128,.35)))}
.detail-placeholder{
  display:flex;flex-direction:column;align-items:center;gap:10px;
  padding:48px 20px;color:var(--muted);font-size:12px;text-align:center;line-height:1.6;
}
.kbd-help{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 12px;margin-top:8px;font-size:11px}
.kbd-help kbd{margin-right:2px}
/* Header: what the paper is, then what you can do with it. */
.detail-head{padding:12px 14px 12px;display:flex;flex-direction:column;gap:6px}
.detail-title{font-weight:600;font-size:14px;line-height:1.35;user-select:text;overflow-wrap:anywhere}
.detail-byline{font-size:12px;line-height:1.45;color:var(--vscode-foreground);opacity:.9}
.detail-meta{font-size:11.5px;color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;gap:0 2px}
.detail-meta .venue{font-style:italic}
.dot-sep{margin:0 5px;opacity:.6}
.link-btn{
  border:none;background:none;padding:0;cursor:pointer;color:inherit;text-align:left;
  display:inline-flex;align-items:center;gap:4px;max-width:100%;
}
.link-btn:hover{color:var(--vscode-textLink-foreground);text-decoration:underline}
.link-btn svg{width:12px;height:12px;flex-shrink:0;opacity:.8}
.link-btn.more,.more-link{color:var(--vscode-textLink-foreground);font-size:11px}
.link-btn.url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}
.detail-byline .link-btn{display:inline}
.detail-toolbar{display:flex;align-items:center;gap:2px;margin-top:4px}
.icon-btn{
  flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
  border:none;background:none;cursor:pointer;border-radius:4px;color:var(--vscode-foreground);opacity:.8;
}
.icon-btn:hover{opacity:1;background:var(--vscode-toolbar-hoverBackground)}
.icon-btn:focus-visible,.action-btn:focus-visible,.detail-tab:focus-visible,.sec-head:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.icon-btn svg{width:15px;height:15px}
.action-btn{
  display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:none;
  background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);
}
.action-btn svg{width:14px;height:14px;flex-shrink:0}
.action-btn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.action-btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.action-btn.primary:hover{background:var(--vscode-button-hoverBackground)}
.action-btn:disabled{opacity:.5;cursor:default}
.open-btn{padding:5px 12px}
.status-seg{display:flex;margin-top:4px;border-radius:4px;overflow:hidden;border:1px solid var(--border)}
.status-seg button{
  flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:3px 0;
  border:none;background:none;cursor:pointer;font-size:11px;color:var(--muted);
}
.status-seg button+button{border-left:1px solid var(--border)}
.status-seg button:hover{background:var(--vscode-list-hoverBackground);color:var(--vscode-foreground)}
.status-seg button.on{background:var(--vscode-list-inactiveSelectionBackground);color:var(--vscode-foreground);font-weight:600}
/* Tags: chips you can click to search, x to remove, and an inline field to add. */
.tag-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:2px}
.tag-chip{
  display:inline-flex;align-items:center;border-radius:10px;font-size:11px;line-height:18px;
  background:var(--vscode-badge-background,rgba(128,128,128,.2));color:var(--vscode-badge-foreground,inherit);
}
.tag-name{border:none;background:none;cursor:pointer;padding:0 2px 0 8px;font-size:11px}
.tag-name:hover{text-decoration:underline}
.tag-x{
  display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:2px;
  border:none;background:none;cursor:pointer;border-radius:50%;opacity:.6;
}
.tag-x svg{width:10px;height:10px}
.tag-x:hover{opacity:1;background:rgba(128,128,128,.3)}
.tag-input{
  flex:1;min-width:70px;max-width:160px;height:20px;padding:0 6px;border-radius:10px;font:inherit;font-size:11px;
  border:1px dashed var(--border);background:none;color:var(--vscode-input-foreground);outline:none;
}
.tag-input::placeholder{color:var(--muted)}
.tag-input:focus{border-style:solid;border-color:var(--vscode-focusBorder);background:var(--vscode-input-background);max-width:none}
/* Tabs stay in reach while a long tab scrolls. */
.detail-tabs{
  position:sticky;top:0;z-index:2;display:flex;gap:2px;padding:0 10px;flex-shrink:0;
  background:var(--side-bg);border-top:1px solid var(--border-soft);border-bottom:1px solid var(--border);
}
.detail-tab{
  position:relative;display:inline-flex;align-items:center;gap:5px;padding:7px 6px 6px;border:none;background:none;cursor:pointer;
  font-size:11px;letter-spacing:.02em;color:var(--muted);white-space:nowrap;
}
.detail-tab:hover{color:var(--vscode-foreground)}
.detail-tab.active{color:var(--vscode-foreground)}
.detail-tab.active::after{content:'';position:absolute;left:4px;right:4px;bottom:-1px;height:2px;background:var(--vscode-panelTitle-activeBorder,var(--vscode-focusBorder))}
.tab-badge{
  min-width:16px;padding:0 4px;border-radius:8px;font-size:10px;line-height:15px;text-align:center;
  background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);
}
.tab-badge.dot{min-width:0;padding:0;background:none;color:var(--vscode-textLink-foreground);font-size:14px;line-height:10px}
.tab-body{flex:1;padding-bottom:16px}
.tab-toolbar{display:flex;align-items:center;gap:4px;padding:8px 14px 6px}
.tab-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:32px 20px;text-align:center;font-size:12px}
.tab-empty>svg{width:28px;height:28px;opacity:.35;margin-bottom:4px}
.tab-empty .action-btn{margin-top:8px}
.loading{display:flex;align-items:center;gap:6px;padding:10px 14px;font-style:normal}
.loading svg{width:12px;height:12px}
/* ── Sections: VS Code pane headers ── */
.sec-head{
  display:flex;align-items:center;justify-content:space-between;height:24px;padding:0 8px 0 4px;cursor:pointer;user-select:none;
  font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));
  background:var(--vscode-sideBarSectionHeader-background,transparent);
  border-top:1px solid var(--vscode-sideBarSectionHeader-border,var(--border-soft));
}
.sec-head:hover{background:var(--vscode-list-hoverBackground)}
.sec-head-left{display:flex;align-items:center;gap:3px;min-width:0}
.sec-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sec-count{margin-left:4px;font-weight:400;opacity:.65}
.sec-chevron{width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .1s}
.sec-chevron svg{width:16px;height:16px}
.sec-head.collapsed .sec-chevron{transform:rotate(-90deg)}
.sec-actions{display:flex;align-items:center;gap:2px;visibility:hidden}
.sec-head:hover .sec-actions,.sec-head:focus-within .sec-actions{visibility:visible}
.sec-actions .icon-btn{width:20px;height:20px}
.sec-actions .icon-btn svg{width:13px;height:13px}
.sec-body{padding:8px 14px 12px 22px;font-size:12px}
.sec-body.hidden{display:none}
.detail-abstract{line-height:1.55;user-select:text;white-space:pre-wrap}
.detail-abstract.clamped{-webkit-line-clamp:6;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}
.more-link{margin-top:4px}
.kw-list{display:flex;flex-wrap:wrap;gap:4px}
.kw{
  padding:1px 8px;border-radius:10px;cursor:pointer;font-size:11px;background:none;
  color:var(--vscode-foreground);border:1px solid var(--border);
}
.kw:hover{border-color:var(--vscode-focusBorder);color:var(--vscode-textLink-foreground)}
/* Label | value on one line each: dense, scannable, and it widens with the pane. */
.kv-grid{display:grid;grid-template-columns:minmax(64px,max-content) minmax(0,1fr);gap:5px 12px;align-items:baseline}
.kv-label{color:var(--muted);font-size:11px;white-space:nowrap}
.kv-value{min-width:0;line-height:1.4;overflow-wrap:anywhere;user-select:text}
.kv-line{display:flex;align-items:center;gap:6px;min-width:0}
.kv-line .icon-btn{width:20px;height:20px;opacity:0}
.kv-line .icon-btn svg{width:12px;height:12px}
.kv-value:hover .kv-line .icon-btn,.kv-line .icon-btn:focus-visible{opacity:.75}
.kv-line .icon-btn:hover{opacity:1}
.seg-tabs{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px}
.seg-tab{padding:2px 8px;border-radius:4px;border:none;background:none;cursor:pointer;font-size:11px;color:var(--muted)}
.seg-tab:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}
.seg-tab.on{color:var(--vscode-foreground);background:var(--vscode-list-inactiveSelectionBackground);font-weight:600}
.cite-box{
  margin:0;padding:8px 10px;border-radius:4px;max-height:220px;overflow:auto;user-select:text;
  white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;line-height:1.5;
  background:var(--vscode-textCodeBlock-background,var(--vscode-editor-background));border:1px solid var(--border-soft);
}
.cite-box.code{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;white-space:pre}
.row-end{display:flex;justify-content:flex-end;margin-top:6px}
/* ── Annotations ── */
.mini-input{
  flex:1;min-width:0;height:24px;padding:0 8px;border-radius:3px;font:inherit;font-size:12px;outline:none;
  background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);
}
.mini-input:focus{border-color:var(--vscode-focusBorder)}
.ann-color{width:14px;height:14px;border-radius:50%;border:2px solid transparent;cursor:pointer;flex-shrink:0;margin:0 1px}
.ann-color.on{border-color:var(--vscode-foreground)}
.ann-color.c-yellow{background:var(--hl-yellow)}.ann-color.c-green{background:var(--hl-green)}.ann-color.c-blue{background:var(--hl-blue)}
.ann-color.c-red{background:var(--hl-red)}.ann-color.c-pink{background:var(--hl-pink)}
.ann-list{padding:0 14px}
.ann-page{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}
.ann-card{
  position:relative;padding:6px 8px 4px 11px;margin-bottom:6px;border-radius:4px;cursor:pointer;
  background:var(--vscode-editorWidget-background,rgba(128,128,128,.08));border:1px solid var(--border-soft);
}
.ann-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:4px 0 0 4px;background:var(--muted)}
.ann-card.c-yellow::before{background:var(--hl-yellow)}.ann-card.c-green::before{background:var(--hl-green)}.ann-card.c-blue::before{background:var(--hl-blue)}
.ann-card.c-red::before{background:var(--hl-red)}.ann-card.c-pink::before{background:var(--hl-pink)}
.ann-card:hover{border-color:var(--vscode-focusBorder)}
.ann-kind{float:left;margin:1px 6px 0 0;display:inline-flex;color:var(--muted)}
.ann-kind svg{width:12px;height:12px}
.ann-text{font-size:12px;line-height:1.5;-webkit-line-clamp:5;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden;user-select:text}
.ann-card.is-note .ann-text{font-style:italic}
.ann-meta{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--muted);margin-top:2px}
.ann-meta .icon-btn{width:20px;height:20px;opacity:0}
.ann-meta .icon-btn svg{width:12px;height:12px}
.ann-card:hover .ann-meta .icon-btn,.ann-meta .icon-btn:focus-visible{opacity:.8}
.sec-body .ann-card{margin-left:-8px}
/* ── Notes ── */
.notes-tab{display:flex;flex-direction:column}
.note-input{
  margin:10px 14px 0;min-height:240px;height:42vh;resize:vertical;padding:8px 10px;border-radius:4px;outline:none;
  font-family:var(--vscode-editor-font-family,var(--vscode-font-family));font-size:12.5px;line-height:1.55;
  background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--border));
}
.note-input:focus{border-color:var(--vscode-focusBorder)}
.note-input::placeholder{color:var(--vscode-input-placeholderForeground)}
/* ── Related, and the list of a multi-selection ── */
.rel-row{
  display:flex;align-items:center;gap:8px;padding:4px 6px;margin:0 -6px;border-radius:4px;cursor:pointer;
}
.rel-row:hover{background:var(--vscode-list-hoverBackground)}
.rel-row>.status-dot{margin-top:1px}
.rel-main{flex:1;min-width:0}
.rel-title{font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rel-sub{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rel-why{margin-left:6px;font-style:italic}
.rel-why::before{content:'· '}
.rel-row .icon-btn{opacity:0;width:22px;height:22px}
.rel-row:hover .icon-btn,.rel-row .icon-btn:focus-visible{opacity:.8}
.sel-list{padding:4px 14px 16px 20px;border-top:1px solid var(--border-soft)}
/* ── Text layer: row icon, "No text" filter, detail banner ── */
.paper-type-icon.no-pdf{opacity:.45}
.paper-type-icon.tl-missing{opacity:1;color:var(--vscode-editorWarning-foreground,#cca700)}
.paper-type-icon.tl-busy{opacity:1;color:var(--vscode-textLink-foreground)}
.paper-row.selected .paper-type-icon.tl-missing,.paper-row.selected .paper-type-icon.tl-busy{color:inherit}
.status-tab.tl-tab{margin-left:6px;position:relative}
.status-tab.tl-tab::before{content:'';position:absolute;left:-5px;top:4px;bottom:4px;border-left:1px solid var(--border)}
.status-tab.tl-tab svg{width:12px;height:12px;color:var(--vscode-editorWarning-foreground,#cca700)}
#tlBanner:empty{display:none}
.tl-banner{
  display:flex;align-items:flex-start;gap:8px;margin-top:4px;padding:7px 9px;border-radius:4px;font-size:11px;line-height:1.45;
  background:var(--vscode-inputValidation-warningBackground,rgba(204,167,0,.1));
  border:1px solid var(--vscode-inputValidation-warningBorder,rgba(204,167,0,.45));
}
.tl-banner.busy{background:var(--vscode-editorWidget-background,rgba(128,128,128,.08));border-color:var(--border)}
.tl-banner>.tl-icon{flex-shrink:0;display:flex;padding-top:1px;color:var(--vscode-editorWarning-foreground,#cca700)}
.tl-banner.busy>.tl-icon{color:var(--vscode-textLink-foreground)}
.tl-banner svg{width:14px;height:14px}
.tl-banner .tl-text{flex:1;min-width:0}
.tl-banner .tl-reason{margin-top:2px;color:var(--muted);word-break:break-word}
.tl-banner .tl-action{display:inline-flex;margin-top:7px}
.tl-progress{margin-top:6px;height:3px;border-radius:2px;overflow:hidden;background:var(--border)}
.tl-progress>span{display:block;height:100%;min-width:3%;background:var(--vscode-progressBar-background,var(--vscode-button-background));transition:width .3s}
/* ── Context menu: VS Code's menu tokens ── */
.ctx-menu{
  position:fixed;z-index:100;min-width:230px;max-width:320px;padding:4px 0;border-radius:6px;
  background:var(--vscode-menu-background,var(--vscode-editorWidget-background));
  color:var(--vscode-menu-foreground,var(--vscode-foreground));
  border:1px solid var(--vscode-menu-border,var(--vscode-widget-border,rgba(128,128,128,.35)));
  box-shadow:0 2px 8px var(--vscode-widget-shadow,rgba(0,0,0,.36));
}
.ctx-item{
  display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:0 4px;padding:3px 8px;border:none;border-radius:4px;
  background:none;cursor:pointer;text-align:left;font-size:12px;line-height:18px;color:inherit;outline:none;
}
.ctx-item:focus,.ctx-item:hover{background:var(--vscode-menu-selectionBackground,var(--vscode-list-activeSelectionBackground));color:var(--vscode-menu-selectionForeground,var(--vscode-list-activeSelectionForeground))}
.ctx-item:disabled{opacity:.45;cursor:default;background:none}
.ctx-item.danger .ctx-label{color:var(--vscode-errorForeground)}
.ctx-item.danger:focus .ctx-label,.ctx-item.danger:hover .ctx-label{color:inherit}
.ctx-icon{width:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;opacity:.85}
.ctx-icon svg{width:14px;height:14px}
.ctx-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctx-key{font-size:11px;opacity:.7;padding-left:12px}
.ctx-sep{height:1px;margin:4px 0;background:var(--vscode-menu-separatorBackground,var(--border))}
`;
}
