/**
 * Module: template.css
 * Responsibility: All theme CSS strings for the PDF viewer webview
 */

export function buildCss(): string {
  return `/* ── Theme variables ────────────────────────────────────────── */
:root{
  --pdf-bg:#1e1e1e;--pdf-canvas-bg:#1e1e1e;
  --pdf-toolbar-bg:#252526;--pdf-toolbar-border:#3c3c3c;--pdf-toolbar-text:#cccccc;
  --pdf-btn-bg:#3c3c3c;--pdf-btn-hover-bg:#505050;
  --pdf-sidebar-bg:#252526;--pdf-sidebar-border:#3c3c3c;
}
[data-pdf-theme="light"]{
  --pdf-bg:#f0f0f0;--pdf-canvas-bg:#ffffff;
  --pdf-toolbar-bg:#e8e8e8;--pdf-toolbar-border:#cccccc;--pdf-toolbar-text:#333333;
  --pdf-btn-bg:#d0d0d0;--pdf-btn-hover-bg:#b8b8b8;
  --pdf-sidebar-bg:#f5f5f5;--pdf-sidebar-border:#dddddd;
}
[data-pdf-theme="dark"]{--pdf-bg:#1e1e1e;--pdf-canvas-bg:#1e1e1e;}
[data-pdf-theme="sepia"]{
  --pdf-bg:#e8dfc8;--pdf-canvas-bg:#faf6ee;
  --pdf-toolbar-bg:#e0d8c0;--pdf-toolbar-border:#c8b89a;--pdf-toolbar-text:#5c4033;
  --pdf-btn-bg:#d4c4a0;--pdf-btn-hover-bg:#c0a878;
  --pdf-sidebar-bg:#ede8d8;--pdf-sidebar-border:#c8b89a;
}
[data-pdf-theme="high-contrast"]{
  --pdf-bg:#000;--pdf-canvas-bg:#000;
  --pdf-toolbar-bg:#000;--pdf-toolbar-border:#fff;--pdf-toolbar-text:#fff;
  --pdf-btn-bg:#000;--pdf-btn-hover-bg:#1a1a1a;
  --pdf-sidebar-bg:#000;--pdf-sidebar-border:#fff;
}

/* ── Reset ──────────────────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:var(--vscode-font-family,'Segoe UI',sans-serif);font-size:13px}
body{background:var(--pdf-bg);color:var(--pdf-toolbar-text);display:flex;flex-direction:column}

/* ── Toolbar ────────────────────────────────────────────────── */
#toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 8px;background:var(--pdf-toolbar-bg);border-bottom:1px solid var(--pdf-toolbar-border);min-height:34px}
.toolbar-sep{width:1px;height:18px;background:var(--pdf-toolbar-border);margin:0 2px}
.tb-btn{display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 4px;border-radius:3px;background:none;border:none;cursor:pointer;color:var(--pdf-toolbar-text);font-size:11px}
.tb-btn:hover:not(:disabled){background:var(--pdf-btn-hover-bg)}
.tb-btn:disabled{opacity:.4;cursor:default}
#pageInput,#zoomSelect,#themeSelect{background:var(--pdf-btn-bg);border:1px solid var(--pdf-toolbar-border);color:var(--pdf-toolbar-text);border-radius:3px;padding:2px 4px;font-size:11px}
#pageInput{width:48px;text-align:center}
.tb-label{display:flex;align-items:center;gap:3px;font-size:11px;color:var(--pdf-toolbar-text);cursor:pointer}
.tb-label input[type="color"]{width:22px;height:22px;padding:2px;border:1px solid var(--pdf-toolbar-border);border-radius:3px;cursor:pointer;background:var(--pdf-btn-bg)}
#annotationsToggle{margin-left:auto}

/* ── Layout ─────────────────────────────────────────────────── */
#main{display:flex;flex:1;overflow:hidden}
#pdf-shell{position:relative;flex:1;background:var(--pdf-bg,#1e1e1e)}

/* ── Viewer container ───────────────────────────────────────── */
#viewerContainer{
  position:absolute;inset:0;overflow:auto;padding:12px;
  background:var(--pdf-canvas-bg);
  transition:background-color 120ms ease;
}
#viewer{--scale-factor:1}
#viewer .page{box-shadow:0 2px 8px rgba(0,0,0,.35)}

/* ── Status messages ─────────────────────────────────────────── */
#loading-msg,#error-msg{position:absolute;left:16px;top:16px;padding:8px 10px;background:rgba(0,0,0,.35);border-radius:4px;font-size:12px}
#error-msg{display:none;color:var(--vscode-errorForeground,#f48771)}

/* ── Sidebar ─────────────────────────────────────────────────── */
#sidebar{width:260px;flex-shrink:0;background:var(--pdf-sidebar-bg);border-left:1px solid var(--pdf-sidebar-border);display:flex;flex-direction:column;overflow:hidden}
#sidebar.hidden{display:none}
#sidebar-header{padding:8px 10px;border-bottom:1px solid var(--pdf-sidebar-border);font-size:12px;font-weight:600}
#annotation-list{flex:1;overflow:auto;padding:4px 0}
.ann-group-header{padding:4px 10px;font-size:10px;text-transform:uppercase;opacity:.6;letter-spacing:.05em}
.ann-item{padding:6px 10px;cursor:pointer;border-bottom:1px solid rgba(128,128,128,.1)}
.ann-item:hover{background:rgba(128,128,128,.1)}
.ann-item-header{display:flex;align-items:center;gap:6px;margin-bottom:2px}
.ann-color-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.ann-color-dot.yellow{background:#f5c518}.ann-color-dot.green{background:#4caf50}.ann-color-dot.blue{background:#2196f3}.ann-color-dot.red{background:#f44336}.ann-color-dot.pink{background:#e91e63}.ann-color-dot.note{background:#9c27b0}
.ann-preview{font-size:11px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ann-actions{display:flex;gap:4px;margin-top:4px}
.ann-act-btn{font-size:10px;padding:1px 6px;border-radius:2px;cursor:pointer;background:rgba(128,128,128,.15);border:none;color:var(--pdf-toolbar-text,#ccc)}
.ann-act-btn.delete{color:#f44336}

/* ── Selection toolbar ──────────────────────────────────────── */
#selection-toolbar{position:fixed;z-index:1000;background:var(--pdf-toolbar-bg,#252526);border:1px solid var(--pdf-toolbar-border,#3c3c3c);border-radius:4px;padding:4px;display:none;gap:4px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.4)}
#selection-toolbar.visible{display:flex}
.color-btn{width:18px;height:18px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.color-btn:hover{border-color:#fff}
.color-btn.yellow{background:#f5c518}.color-btn.green{background:#4caf50}.color-btn.blue{background:#2196f3}.color-btn.red{background:#f44336}.color-btn.pink{background:#e91e63}`;
}
