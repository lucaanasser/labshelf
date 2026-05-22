/**
 * Generates the complete HTML document for the PDF viewer webview, resolving PDF.js asset URIs and injecting theme CSS and the viewer script.
 *
 * @depends pdf-viewer/ThemeManager.ts, pdf-viewer/config.ts, pdf-viewer/renderer/template.css.ts, pdf-viewer/renderer/template.js.ts, @labshelf/core
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/PdfRenderer.ts (re-export shim), pdf-viewer/renderer/index.ts, pdf-viewer/index.ts
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { ThemeManager } from "../ThemeManager.js";
import { PDF_VIEWER_CONFIG } from "../config.js";
import type { Annotation } from "@labshelf/core";
import { buildCss } from "./template.css.js";
import { buildJs } from "./template.js.js";

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

/**
 * Resolves pdfjs-dist file paths (including cmaps, fonts, wasm, iccs) and converts them to webview-safe URIs.
 * @usedBy pdf-viewer/renderer/PdfRenderer.ts (generateHtml), pdf-viewer/index.ts, pdf-viewer/PdfRenderer.ts (shim)
 * @returns A ResolvedUris object with all webview URIs, or null if pdfjs-dist cannot be located.
 */
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

/**
 * Locates and returns the pdfjs-dist package root directory as a vscode.Uri for use in webview localResourceRoots.
 * @usedBy pdf-viewer/PdfViewerPanel.ts, pdf-viewer/index.ts, pdf-viewer/PdfRenderer.ts (shim)
 * @returns A vscode.Uri pointing to the pdfjs-dist root, or null if the package cannot be resolved.
 */
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
  /**
   * Generates the full HTML document for the PDF viewer webview, including CSP header, theme CSS, and the PDF.js module script.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns An HTML string ready to assign to webview.html.
   */
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

    const css = buildCss();
    const js  = buildJs({
      nonce: n,
      pdfjsUrl,
      viewerUrl,
      workerUrl,
      pdfUrl,
      cMapUrl,
      stdFontUrl,
      wasmUrl,
      iccUrl,
      zoomLevelsJson,
      themePreference,
      effectiveTheme,
      initialPage,
      initialZoom,
      annotationsJson,
      defaultZoom: PDF_VIEWER_CONFIG.DEFAULT_ZOOM,
    });

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
${css}
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

${js}
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
