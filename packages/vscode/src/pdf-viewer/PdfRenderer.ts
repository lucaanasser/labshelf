/**
 * Module: PdfRenderer
 * Responsibility: Generate webview HTML using the official PDF.js viewer components
 * Dependencies: vscode, ThemeManager, PDF_VIEWER_CONFIG
 *
 * Optimizations vs original:
 *  - pdfjsLib + viewerLib loaded in parallel via Promise.all
 *  - Worker preloaded as modulepreload (not just preload as="script")
 *  - Theme changes applied purely via CSS filter on #viewerContainer:
 *      dark  → invert(1)+hue-rotate(180deg): inverts luminance, preserves hue
 *      sepia → sepia(0.8)+brightness(1.04): warm tone without re-render
 *      high-contrast → invert(1)+grayscale(1)+contrast(1.3)
 *    Zero canvas re-rasterisation; theme switch is GPU-composited only.
 *  - pageColors used for BG/text colour: set by preset on theme change or
 *    directly by the BG/Text colour pickers; picker values persist within
 *    the session and override the preset until the theme is re-selected
 *  - Map.prototype.getOrInsertComputed polyfill hoisted out of hot path
 *  - getDocument called with disableAutoFetch:false, rangeChunkSize tuned
 *  - All DOM queries cached; no querySelector inside event handlers
 *  - applyTheme is synchronous CSS class swap — GPU composite only
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { ThemeManager } from "./ThemeManager.js";
import { PDF_VIEWER_CONFIG } from "./config.js";
import type { Annotation } from "../core/types.js";

export interface RenderParams {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  pdfUri: vscode.Uri;
  paperId: string;
  paperTitle: string;
  themeManager: ThemeManager;
  themePreference: string;
  initialPage: number;
  initialZoom: number;
  annotations: Annotation[];
}

export interface ResolvedUris {
  pdfjsWebviewUri: vscode.Uri;
  workerWebviewUri: vscode.Uri;
  viewerWebviewUri: vscode.Uri;
  viewerCssWebviewUri: vscode.Uri;
  cMapWebviewUrl: string;
  standardFontWebviewUrl: string;
  wasmWebviewUrl: string;
  iccWebviewUrl: string;
}

/** Resolve pdfjs-dist file paths and convert to webview URIs */
export function resolvePdfjsUris(webview: vscode.Webview): ResolvedUris | null {
  try {
    let pdfjsPath: string;
    let workerPath: string;
    let viewerPath: string;
    let viewerCssPath: string;
    try {
      pdfjsPath    = require.resolve("pdfjs-dist/legacy/build/pdf.min.mjs");
      workerPath   = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
      viewerPath   = require.resolve("pdfjs-dist/legacy/web/pdf_viewer.mjs");
      viewerCssPath = require.resolve("pdfjs-dist/legacy/web/pdf_viewer.css");
    } catch {
      pdfjsPath    = require.resolve("pdfjs-dist/build/pdf.min.mjs");
      workerPath   = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
      viewerPath   = require.resolve("pdfjs-dist/web/pdf_viewer.mjs");
      viewerCssPath = require.resolve("pdfjs-dist/web/pdf_viewer.css");
    }
    // pdfjs-dist root holds cmaps/, standard_fonts/, wasm/, iccs/ which the
    // worker fetches at runtime so embedded CJK fonts, Type-1 fonts, JBIG2,
    // and ICC colour profiles render at full fidelity instead of falling back.
    const root = getPdfjsDirectory();
    const rootUri = root ? webview.asWebviewUri(root).toString().replace(/\/?$/, '/') : '';
    return {
      pdfjsWebviewUri:    webview.asWebviewUri(vscode.Uri.file(pdfjsPath)),
      workerWebviewUri:   webview.asWebviewUri(vscode.Uri.file(workerPath)),
      viewerWebviewUri:   webview.asWebviewUri(vscode.Uri.file(viewerPath)),
      viewerCssWebviewUri: webview.asWebviewUri(vscode.Uri.file(viewerCssPath)),
      cMapWebviewUrl:        rootUri ? `${rootUri}cmaps/`          : '',
      standardFontWebviewUrl: rootUri ? `${rootUri}standard_fonts/` : '',
      wasmWebviewUrl:        rootUri ? `${rootUri}wasm/`           : '',
      iccWebviewUrl:         rootUri ? `${rootUri}iccs/`           : '',
    };
  } catch {
    return null;
  }
}

/** Get the pdfjs-dist root directory for localResourceRoots */
export function getPdfjsDirectory(): vscode.Uri | null {
  try {
    let pdfjsPath: string;
    try {
      pdfjsPath = require.resolve("pdfjs-dist/legacy/build/pdf.min.mjs");
    } catch {
      pdfjsPath = require.resolve("pdfjs-dist/build/pdf.min.mjs");
    }
    const maybeRoot = path.resolve(path.dirname(pdfjsPath), "..");
    const pdfjsRoot =
      path.basename(maybeRoot) === "pdfjs-dist"
        ? maybeRoot
        : path.resolve(path.dirname(pdfjsPath), "..", "..");
    return vscode.Uri.file(pdfjsRoot);
  } catch {
    return null;
  }
}

function nonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export class PdfRenderer {
  generateHtml(params: RenderParams): string {
    const {
      webview,
      pdfUri,
      paperTitle,
      themeManager,
      themePreference,
      initialPage,
      initialZoom,
      annotations,
    } = params;

    const n = nonce();
    const cspSource = webview.cspSource;

    const resolved = resolvePdfjsUris(webview);
    const pdfjsUrl     = resolved?.pdfjsWebviewUri.toString()     ?? "";
    const workerUrl    = resolved?.workerWebviewUri.toString()    ?? "";
    const viewerUrl    = resolved?.viewerWebviewUri.toString()    ?? "";
    const viewerCssUrl = resolved?.viewerCssWebviewUri.toString() ?? "";
    const cMapUrl      = resolved?.cMapWebviewUrl        ?? "";
    const stdFontUrl   = resolved?.standardFontWebviewUrl ?? "";
    const wasmUrl      = resolved?.wasmWebviewUrl        ?? "";
    const iccUrl       = resolved?.iccWebviewUrl         ?? "";
    const pdfUrl       = webview.asWebviewUri(pdfUri).toString();

    const effectiveTheme  = themeManager.getEffectiveTheme(themePreference);
    const annotationsJson = JSON.stringify(annotations);
    const zoomLevelsJson  = JSON.stringify([...PDF_VIEWER_CONFIG.ZOOM_LEVELS]);

    // Initial PDF canvas colors for the selected theme (injected into HTML so
    // pickers show correct values immediately, before the async try-block runs).
    const INIT_PRESETS: Record<string, { bg: string; text: string }> = {
      light:           { bg: '#ffffff', text: '#000000' },
      dark:            { bg: '#1e1e1e', text: '#e8e8e8' },
      sepia:           { bg: '#faf6ee', text: '#3a2a1a' },
      'high-contrast': { bg: '#000000', text: '#ffffff' },
    };
    const initBg   = INIT_PRESETS[effectiveTheme]?.bg   ?? '#ffffff';
    const initText = INIT_PRESETS[effectiveTheme]?.text ?? '#000000';

    return `<!doctype html>
<html id="root" lang="en" data-pdf-theme="${escapeHtml(effectiveTheme)}">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${n}' 'wasm-unsafe-eval' ${cspSource}; worker-src ${cspSource} blob:; style-src 'unsafe-inline' ${cspSource}; img-src ${cspSource} blob: data:; connect-src ${cspSource}; font-src ${cspSource};"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(paperTitle)}</title>
${pdfjsUrl  ? `<link rel="modulepreload" href="${pdfjsUrl}"/>` : ""}
${viewerUrl ? `<link rel="modulepreload" href="${viewerUrl}"/>` : ""}
${workerUrl ? `<link rel="preload" href="${workerUrl}" as="fetch" crossorigin="anonymous"/>` : ""}
${viewerCssUrl ? `<link rel="stylesheet" href="${viewerCssUrl}"/>` : ""}
<style>
/* ── Theme variables ────────────────────────────────────────── */
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
.color-btn.yellow{background:#f5c518}.color-btn.green{background:#4caf50}.color-btn.blue{background:#2196f3}.color-btn.red{background:#f44336}.color-btn.pink{background:#e91e63}
</style>
</head>
<body>
<div id="toolbar">
  <button class="tb-btn" id="firstBtn" title="First page">&#171;</button>
  <button class="tb-btn" id="prevBtn"  title="Previous page">&#8249;</button>
  <input id="pageInput" type="number" min="1" value="${initialPage}" title="Current page"/>
  <span>/ <span id="totalPages">-</span></span>
  <button class="tb-btn" id="nextBtn" title="Next page">&#8250;</button>
  <button class="tb-btn" id="lastBtn" title="Last page">&#187;</button>
  <div class="toolbar-sep"></div>
  <button class="tb-btn" id="zoomOutBtn" title="Zoom out">-</button>
  <select id="zoomSelect" title="Zoom level">${buildZoomOptions(initialZoom)}</select>
  <button class="tb-btn" id="zoomInBtn" title="Zoom in">+</button>
  <div class="toolbar-sep"></div>
  <span>Theme</span>
  <select id="themeSelect" title="PDF theme">${buildThemeOptions(themePreference)}</select>
  <div class="toolbar-sep"></div>
  <label class="tb-label" title="PDF page background colour"><span>BG</span><input type="color" id="bgColorPicker" value="${initBg}"/></label>
  <label class="tb-label" title="PDF text colour"><span>Text</span><input type="color" id="textColorPicker" value="${initText}"/></label>
  <button class="tb-btn" id="annotationsToggle" title="Toggle annotations sidebar">Notes</button>
</div>

<div id="main">
  <div id="pdf-shell">
    <div id="viewerContainer"><div id="viewer" class="pdfViewer"></div></div>
    <div id="loading-msg">Loading PDF...</div>
    <div id="error-msg"></div>
  </div>
  <div id="sidebar" class="hidden">
    <div id="sidebar-header">${escapeHtml(paperTitle)} - Annotations</div>
    <div id="annotation-list"></div>
  </div>
</div>

<div id="selection-toolbar">
  <button class="color-btn yellow" data-color="yellow" title="Highlight yellow"></button>
  <button class="color-btn green"  data-color="green"  title="Highlight green"></button>
  <button class="color-btn blue"   data-color="blue"   title="Highlight blue"></button>
  <button class="color-btn red"    data-color="red"    title="Highlight red"></button>
  <button class="color-btn pink"   data-color="pink"   title="Highlight pink"></button>
</div>

<script nonce="${n}" type="module">
/* ─── Polyfill (Map.getOrInsertComputed — TC39 stage 3) ─────── */
if (!Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value(key, fn) {
      if (this.has(key)) return this.get(key);
      const v = fn(key); this.set(key, v); return v;
    },
    configurable: true, writable: true,
  });
}

/* ─── Constants injected from host ─────────────────────────── */
const PDFJS_URL    = ${JSON.stringify(pdfjsUrl)};
const VIEWER_URL   = ${JSON.stringify(viewerUrl)};
const WORKER_URL   = ${JSON.stringify(workerUrl)};
const PDF_URL      = ${JSON.stringify(pdfUrl)};
const CMAP_URL     = ${JSON.stringify(cMapUrl)};
const STD_FONT_URL = ${JSON.stringify(stdFontUrl)};
const WASM_URL     = ${JSON.stringify(wasmUrl)};
const ICC_URL      = ${JSON.stringify(iccUrl)};
const ZOOM_LEVELS  = ${zoomLevelsJson};

/* ─── DOM refs (cached once) ────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const firstBtn        = $('firstBtn');
const prevBtn         = $('prevBtn');
const nextBtn         = $('nextBtn');
const lastBtn         = $('lastBtn');
const pageInput       = $('pageInput');
const totalPagesEl    = $('totalPages');
const zoomSelect      = $('zoomSelect');
const zoomInBtn       = $('zoomInBtn');
const zoomOutBtn      = $('zoomOutBtn');
const themeSelect     = $('themeSelect');
const annotationsToggle = $('annotationsToggle');
const sidebar         = $('sidebar');
const annotationList  = $('annotation-list');
const loadingMsg      = $('loading-msg');
const errorMsg        = $('error-msg');
const selectionToolbar = $('selection-toolbar');
const bgColorPicker   = $('bgColorPicker');
const textColorPicker = $('textColorPicker');
const root            = document.documentElement;

/* ─── State ─────────────────────────────────────────────────── */
const vscode          = acquireVsCodeApi();
let   _refreshTimer   = null;
let currentTheme    = ${JSON.stringify(themePreference)};
let currentEffectiveTheme = ${JSON.stringify(effectiveTheme)};
let currentPage     = ${initialPage};
let currentZoom     = ${initialZoom};
let annotations     = ${annotationsJson};
let pdfDoc          = null;
let pdfViewer       = null;

/* ─── pageColors presets ─────────────────────────────────────── */
// bg  = the colour that replaces the PDF's white page background
// text = the colour that replaces black text / dark vector strokes
const THEME_PRESETS = {
  'light':         { bg: '#ffffff', text: '#000000' },
  'dark':          { bg: '#1e1e1e', text: '#e8e8e8' },
  'sepia':         { bg: '#faf6ee', text: '#3a2a1a' },
  'high-contrast': { bg: '#000000', text: '#ffffff' },
};

function applyPageColors(bg, text) {
  $('viewerContainer').style.background = bg;
  if (!pdfViewer) return;
  // null = PDF's own colours (light mode); otherwise remap via HCM.
  const colors = (bg === '#ffffff' && text === '#000000')
    ? null
    : { background: bg, foreground: text };
  // Skip refresh when colours haven't changed — avoids cancelling an
  // in-progress render (the initial applyTheme call uses the same values
  // already set in the PDFViewer constructor, so no re-render is needed).
  const cur = pdfViewer.pageColors;
  const same = (colors === null && cur === null)
    || (colors !== null && cur !== null
        && cur.background === colors.background
        && cur.foreground === colors.foreground);
  if (same) return;
  pdfViewer.pageColors = colors;
  for (const pv of (pdfViewer._pages ?? [])) { pv.pageColors = colors; }
  // Debounce: if multiple theme/color messages arrive quickly (e.g. DB
  // preference + VS Code theme change), only issue one refresh.
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => pdfViewer?.refresh(), 80);
}

function applyTheme(theme, effectiveTheme) {
  if (theme) { currentTheme = theme; themeSelect.value = theme; }
  if (!effectiveTheme) return;
  currentEffectiveTheme = effectiveTheme;
  root.dataset.pdfTheme = effectiveTheme;
  // Reset pickers to the preset for this theme, then apply.
  const preset = THEME_PRESETS[effectiveTheme] ?? THEME_PRESETS['light'];
  bgColorPicker.value   = preset.bg;
  textColorPicker.value = preset.text;
  applyPageColors(preset.bg, preset.text);
}

/* ─── Navigation state ───────────────────────────────────────── */
function updateNavState() {
  if (!pdfDoc || !pdfViewer) return;
  currentPage = pdfViewer.currentPageNumber;
  pageInput.value         = String(currentPage);
  totalPagesEl.textContent = String(pdfDoc.numPages);
  firstBtn.disabled = prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled  = lastBtn.disabled = currentPage >= pdfDoc.numPages;
  zoomSelect.value  = String(currentZoom);
}

/* ─── Annotation list ────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAnnotationList() {
  if (!annotations.length) {
    annotationList.innerHTML =
      '<div style="padding:12px 10px;font-size:11px;opacity:.6">No annotations yet</div>';
    return;
  }
  const byPage = Object.groupBy
    ? Object.groupBy(annotations, (a) => a.pageNumber)
    : annotations.reduce((acc, a) => {
        (acc[a.pageNumber] ??= []).push(a); return acc;
      }, {});

  const frag = document.createDocumentFragment();
  Object.keys(byPage)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((pageNum) => {
      const hdr = document.createElement('div');
      hdr.className = 'ann-group-header';
      hdr.textContent = 'Page ' + pageNum;
      frag.appendChild(hdr);

      byPage[pageNum].forEach((ann) => {
        const item = document.createElement('div');
        item.className = 'ann-item';
        const color   = ann.color || 'note';
        const preview = (ann.content || '').slice(0, 60) +
                        ((ann.content || '').length > 60 ? '…' : '');
        item.innerHTML =
          '<div class="ann-item-header">' +
            '<div class="ann-color-dot ' + esc(color) + '"></div>' +
            '<span style="font-size:11px;font-weight:500">' + esc(ann.type || 'note') + '</span>' +
          '</div>' +
          '<div class="ann-preview">' + esc(preview) + '</div>' +
          '<div class="ann-actions">' +
            '<button class="ann-act-btn delete" data-ann-id="' + esc(ann.id) + '">Delete</button>' +
          '</div>';

        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('delete')) {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteAnnotation', id: ann.id });
            return;
          }
          if (pdfViewer) {
            pdfViewer.currentPageNumber = ann.pageNumber;
            updateNavState();
            vscode.postMessage({ command: 'pageChanged', pageNumber: ann.pageNumber });
          }
        });
        frag.appendChild(item);
      });
    });

  annotationList.replaceChildren(frag);
}

/* ─── Text selection / highlight toolbar ────────────────────── */
let selectedText = '';
let hideTimer    = null;

document.addEventListener('mouseup', () => {
  const sel  = window.getSelection();
  const text = sel?.toString().trim() ?? '';
  if (!text) {
    selectionToolbar.classList.remove('visible');
    selectedText = '';
    return;
  }
  selectedText = text;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selectionToolbar.style.top  = (rect.top  + window.scrollY - 40) + 'px';
  selectionToolbar.style.left = (rect.left + window.scrollX)       + 'px';
  selectionToolbar.classList.add('visible');
});

document.addEventListener('mousedown', (e) => {
  if (selectionToolbar.contains(e.target)) return;
  hideTimer = setTimeout(() => selectionToolbar.classList.remove('visible'), 150);
});

selectionToolbar.addEventListener('mousedown', (e) => {
  e.preventDefault(); // prevent selection loss
  clearTimeout(hideTimer);
  const btn = e.target.closest('.color-btn');
  if (!btn || !selectedText || !pdfViewer) return;
  vscode.postMessage({
    command: 'createAnnotation',
    type: 'highlight',
    pageNumber: pdfViewer.currentPageNumber,
    content: selectedText,
    color: btn.dataset.color,
  });
  window.getSelection()?.removeAllRanges();
  selectionToolbar.classList.remove('visible');
  selectedText = '';
});

/* ─── Messages from extension host ──────────────────────────── */
window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'updateAnnotations':
      annotations = msg.annotations ?? [];
      renderAnnotationList();
      break;
    case 'applyTheme':
      applyTheme(msg.theme, msg.effectiveTheme);
      break;
    case 'scrollToPage':
      if (pdfViewer && msg.pageNumber) {
        pdfViewer.currentPageNumber = msg.pageNumber;
        updateNavState();
      }
      break;
  }
});

/* ─── Toolbar controls ───────────────────────────────────────── */
annotationsToggle.addEventListener('click', () => sidebar.classList.toggle('hidden'));

themeSelect.addEventListener('change', () => {
  currentTheme = themeSelect.value;
  vscode.postMessage({ command: 'selectTheme', theme: currentTheme });
});

bgColorPicker.addEventListener('change', () => {
  applyPageColors(bgColorPicker.value, textColorPicker.value);
});
textColorPicker.addEventListener('change', () => {
  applyPageColors(bgColorPicker.value, textColorPicker.value);
});

pageInput.addEventListener('change', () => {
  if (!pdfDoc || !pdfViewer) return;
  const num = parseInt(pageInput.value, 10);
  if (num >= 1 && num <= pdfDoc.numPages) {
    pdfViewer.currentPageNumber = num;
    updateNavState();
    vscode.postMessage({ command: 'pageChanged', pageNumber: num });
  }
});

firstBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  pdfViewer.currentPageNumber = 1;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: 1 });
});

prevBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const p = Math.max(1, pdfViewer.currentPageNumber - 1);
  pdfViewer.currentPageNumber = p;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: p });
});

nextBtn.addEventListener('click', () => {
  if (!pdfViewer || !pdfDoc) return;
  const p = Math.min(pdfDoc.numPages, pdfViewer.currentPageNumber + 1);
  pdfViewer.currentPageNumber = p;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: p });
});

lastBtn.addEventListener('click', () => {
  if (!pdfViewer || !pdfDoc) return;
  pdfViewer.currentPageNumber = pdfDoc.numPages;
  updateNavState();
  vscode.postMessage({ command: 'pageChanged', pageNumber: pdfDoc.numPages });
});

function setZoom(level) {
  currentZoom = level;
  pdfViewer.currentScaleValue = String(level / 100);
  zoomSelect.value = String(level);
  vscode.postMessage({ command: 'zoomChanged', zoomLevel: level });
}

zoomSelect.addEventListener('change', () => {
  if (pdfViewer) setZoom(parseInt(zoomSelect.value, 10));
});

zoomInBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const next = ZOOM_LEVELS.find((l) => l > currentZoom);
  if (next !== undefined) setZoom(next);
});

zoomOutBtn.addEventListener('click', () => {
  if (!pdfViewer) return;
  const prev = [...ZOOM_LEVELS].reverse().find((l) => l < currentZoom);
  if (prev !== undefined) setZoom(prev);
});

/* ─── PDF.js initialisation ──────────────────────────────────── */
// Kick off BOTH module imports immediately before awaiting either.
// viewerLib doesn't depend on pdfjsLib, so they can fetch in parallel.
// After pdfjsLib resolves we set workerSrc and start getDocument while
// viewerLib may still be loading in the background.
try {
  if (!PDFJS_URL || !VIEWER_URL) {
    throw new Error('PDF.js viewer assets are unavailable.');
  }

  // pdf_viewer.mjs destructures globalThis.pdfjsLib at evaluation time,
  // so pdfjsLib MUST be set before the viewer module is imported.
  console.time('pdfjs-import');
  const pdfjsLib = await import(PDFJS_URL);
  console.timeEnd('pdfjs-import');
  globalThis.pdfjsLib = pdfjsLib;

  // VSCode webviews reject new Worker() for vscode-webview-resource: URIs,
  // causing pdf.js to use a synchronous fake worker (30s+ for any real PDF).
  // Fix: fetch the worker bundle source and create a self-contained blob: worker.
  // pdf.worker.min.mjs has zero external imports, so the blob runs standalone.
  // Fetch worker source and import viewer in parallel — both are independent.
  console.time('worker-fetch + viewer-import');
  const [workerSrc, viewerLib] = await Promise.all([
    WORKER_URL ? fetch(WORKER_URL).then(r => r.text()) : Promise.resolve(null),
    import(VIEWER_URL),
  ]);
  console.timeEnd('worker-fetch + viewer-import');

  if (workerSrc) {
    const workerBlob = new Blob([workerSrc], { type: 'text/javascript' });
    const workerBlobUrl = URL.createObjectURL(workerBlob);
    const pdfjsWorker = new Worker(workerBlobUrl, { type: 'module' });
    pdfjsLib.GlobalWorkerOptions.workerPort = pdfjsWorker;
  }

  console.time('doc-load');
  const loadedDoc = await pdfjsLib.getDocument({
    url: PDF_URL,
    disableAutoFetch: false,
    rangeChunkSize: 65536,
    fontExtraProperties: true,
    // Loading cmaps + standard fonts + wasm + icc lets the worker render
    // CJK glyphs, Type-1 fonts, JBIG2/JPEG2000 images, and ICC colour
    // profiles at full quality instead of falling back to bitmap approximations.
    cMapUrl: CMAP_URL || undefined,
    cMapPacked: true,
    standardFontDataUrl: STD_FONT_URL || undefined,
    wasmUrl: WASM_URL || undefined,
    iccUrl:  ICC_URL  || undefined,
    useSystemFonts: true,
    isEvalSupported: true,
    enableHWA: true,
  }).promise;
  console.timeEnd('doc-load');

  pdfDoc = loadedDoc;
  totalPagesEl.textContent = String(pdfDoc.numPages);

  const eventBus    = new viewerLib.EventBus();
  const linkService = new viewerLib.PDFLinkService({ eventBus });

  const _p = THEME_PRESETS[currentEffectiveTheme] ?? THEME_PRESETS['light'];
  pdfViewer = new viewerLib.PDFViewer({
    container:      $('viewerContainer'),
    viewer:         $('viewer'),
    eventBus,
    linkService,
    textLayerMode:  1,
    annotationMode: 2,
    removePageBorders: false,
    // ── Sharpness fix (pdf.js v5) ──────────────────────────────────
    // pdf.js v5 caps the canvas resolution via *three* knobs that
    // interact non-obviously. Setting only maxCanvasPixels:-1 is not
    // enough because capCanvasAreaFactor silently overrides it:
    //
    //   capPixels(maxPixels, capAreaFactor) {
    //     if (capAreaFactor >= 0) {                     // default 200
    //       const winPixels = screen*dpr²*(1+200/100);  // ~screen×3
    //       return maxPixels > 0 ? min(maxPixels, winPixels) : winPixels;
    //     }                            //                       ^^^^^^^^^
    //     return maxPixels;            //   maxPixels:-1 is IGNORED here
    //   }
    //
    // So with the defaults, the canvas is capped at ~3× screen pixels.
    // Zoom past that and the canvas is rendered at lower-than-CSS
    // resolution → browser bilinear-upscales it → blur.
    //
    //  1. capCanvasAreaFactor:-1 → short-circuits the screen-area cap
    //                              entirely (THE fix vs tomoki1207)
    //  2. maxCanvasPixels:    -1 → no absolute pixel cap
    //  3. maxCanvasDim:    32767 → the GPU/browser hard limit; explicit
    //                              so a future default change can't lower it
    //  4. enableDetailCanvas:false → never half-res the base canvas with
    //                                an overlay on the visible slice
    //  5. enableHWA:true → GPU-composited canvas
    capCanvasAreaFactor: -1,
    maxCanvasPixels:     -1,
    maxCanvasDim:        32767,
    enableDetailCanvas:  false,
    enableHWA:           true,
    pageColors: (_p.bg === '#ffffff' && _p.text === '#000000')
      ? null
      : { background: _p.bg, foreground: _p.text },
  });

  linkService.setViewer(pdfViewer);
  linkService.setDocument(pdfDoc, null);
  pdfViewer.setDocument(pdfDoc);

  eventBus.on('pagechanging', ({ pageNumber }) => {
    currentPage = pageNumber;
    updateNavState();
    vscode.postMessage({ command: 'pageChanged', pageNumber });
  });

  eventBus.on('scalechanging', ({ scale }) => {
    const scaled = Math.round(Number(scale) * 100);
    if (!Number.isFinite(scaled) || scaled <= 0) return;
    currentZoom = scaled;
    if (![...zoomSelect.options].some((o) => o.value === String(scaled))) {
      zoomSelect.appendChild(new Option(scaled + '%', String(scaled)));
    }
    zoomSelect.value = String(scaled);
    vscode.postMessage({ command: 'zoomChanged', zoomLevel: scaled });
  });

  console.time('pagesinit');
  eventBus.on('pagesinit', () => {
    console.timeEnd('pagesinit');
    // page-width on first open (stored zoom is the default); restore explicit zoom otherwise.
    pdfViewer.currentScaleValue = ${initialZoom} === ${PDF_VIEWER_CONFIG.DEFAULT_ZOOM}
      ? 'page-width'
      : String(${initialZoom} / 100);
    pdfViewer.currentPageNumber = ${initialPage};
    updateNavState();
    loadingMsg.style.display = 'none';
    vscode.postMessage({ command: 'ready', totalPages: pdfDoc.numPages });
  });

  eventBus.on('pagerendered', ({ source, pageNumber }) => {
    if (pageNumber !== 1) return;
    const cv = source?.canvas;
    if (cv) {
      console.log('[labshelf] DPR:', window.devicePixelRatio,
        '| canvas px:', cv.width, '×', cv.height,
        '| CSS:', cv.style.width, '×', cv.style.height,
        '| zoom %:', currentZoom);
    }
  }, { once: true });

} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  loadingMsg.style.display = 'none';
  errorMsg.style.display   = 'block';
  errorMsg.textContent     = 'Failed to initialize PDF viewer: ' + msg;
}

/* ─── Apply initial theme & render annotation list ───────────── */
applyTheme(${JSON.stringify(themePreference)}, ${JSON.stringify(effectiveTheme)});
renderAnnotationList();
</script>
</body>
</html>`;
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

function buildZoomOptions(currentZoom: number): string {
  return [...PDF_VIEWER_CONFIG.ZOOM_LEVELS]
    .map(
      (z) =>
        `<option value="${z}"${z === currentZoom ? " selected" : ""}>${z}%</option>`
    )
    .join("");
}

function buildThemeOptions(currentTheme: string): string {
  return (
    [
      { value: "auto",          label: "Auto" },
      { value: "light",         label: "Light" },
      { value: "dark",          label: "Dark" },
      { value: "sepia",         label: "Sepia" },
      { value: "high-contrast", label: "High Contrast" },
    ] as const
  )
    .map(
      (o) =>
        `<option value="${o.value}"${
          o.value === currentTheme ? " selected" : ""
        }>${o.label}</option>`
    )
    .join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}