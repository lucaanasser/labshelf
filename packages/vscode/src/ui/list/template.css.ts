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
`;
}
