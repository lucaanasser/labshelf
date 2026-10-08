/**
 * Generates the HTML shell of the PDF reader webview: CSP, pdf.js asset preloads, structural containers, the inert JSON boot block and the bundled runtime (dist/reader).
 * All behaviour lives in the bundle built from @labshelf/reader (src/webview/main.ts) by build/reader.mjs; the body
 * skeleton is the shared READER_SHELL_BODY, which the browser extension's reader page uses too.
 *
 * @depends pdf-viewer/ThemeManager.ts, @labshelf/reader, @labshelf/core
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/PdfRenderer.ts (re-export shim), pdf-viewer/renderer/index.ts, pdf-viewer/index.ts
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PdfTheme } from "@labshelf/core";
import { ThemeManager } from "../ThemeManager.js";
import {
  PROTOCOL_VERSION,
  READER_SHELL_BODY,
  type EffectiveTheme,
  type ReaderBootParams,
  type ReaderPrefs,
} from "@labshelf/reader";

export interface RenderParams {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  pdfUri: vscode.Uri;
  paperId: string;
  paperTitle: string;
  themeManager: ThemeManager;
  themePreference: PdfTheme;
  prefs: ReaderPrefs;
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

export interface ReaderBundleUris {
  scriptUri: vscode.Uri;
  styleUri: vscode.Uri;
}

/**
 * Directory holding the esbuild output of the reader webview, for use in localResourceRoots.
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns <extension>/dist/reader
 */
export function getReaderBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "reader");
}

/**
 * Resolves the bundled reader runtime to webview URIs.
 * @usedBy pdf-viewer/renderer/PdfRenderer.ts (generateHtml)
 * @returns the script and stylesheet URIs, or null when the bundle has not been built (dev checkout before `pnpm build`).
 */
export function resolveReaderBundleUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): ReaderBundleUris | null {
  const dir = getReaderBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "reader.js");
  if (!fs.existsSync(script.fsPath)) { return null; }
  return {
    scriptUri: webview.asWebviewUri(script),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dir, "reader.css")),
  };
}

export class PdfRenderer {
  /**
   * Generates the reader's HTML shell. The document carries no behaviour of its own: the bundle reads the JSON boot block and builds the UI.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns An HTML string ready to assign to webview.html.
   */
  generateHtml(params: RenderParams): string {
    const { webview, extensionUri, pdfUri, paperId, paperTitle, themeManager, themePreference, prefs } = params;

    const bundle = resolveReaderBundleUris(webview, extensionUri);
    if (!bundle) { return bundleMissingHtml(paperTitle); }

    const n = nonce();
    const cspSource = webview.cspSource;
    const resolved = resolvePdfjsUris(webview);
    const pdfjsUrl     = resolved?.pdfjsWebviewUri.toString()     ?? "";
    const workerUrl    = resolved?.workerWebviewUri.toString()    ?? "";
    const viewerUrl    = resolved?.viewerWebviewUri.toString()    ?? "";
    const viewerCssUrl = resolved?.viewerCssWebviewUri.toString() ?? "";
    const pdfUrl       = webview.asWebviewUri(pdfUri).toString();
    const scriptUrl    = bundle.scriptUri.toString();
    const styleUrl     = bundle.styleUri.toString();

    const effectiveTheme = themeManager.getEffectiveTheme(themePreference) as EffectiveTheme;
    const boot: ReaderBootParams = {
      protocolVersion: PROTOCOL_VERSION,
      assets: {
        pdfjsUrl,
        viewerUrl,
        workerUrl,
        pdfUrl,
        cMapUrl:    resolved?.cMapWebviewUrl         ?? "",
        stdFontUrl: resolved?.standardFontWebviewUrl ?? "",
        wasmUrl:    resolved?.wasmWebviewUrl         ?? "",
        iccUrl:     resolved?.iccWebviewUrl          ?? "",
      },
      paperId,
      paperTitle,
      themePreference,
      effectiveTheme,
      prefs,
      isMac: process.platform === "darwin",
    };

    return `<!doctype html>
<html id="root" lang="en" data-pdf-theme="${escapeHtml(effectiveTheme)}">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${n}' 'wasm-unsafe-eval' ${cspSource}; worker-src ${cspSource} blob:; style-src 'unsafe-inline' ${cspSource}; img-src ${cspSource} blob: data:; connect-src ${cspSource}; font-src ${cspSource};"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(paperTitle)}</title>
${pdfjsUrl  ? `<link rel="modulepreload" href="${pdfjsUrl}"/>` : ""}
${viewerUrl ? `<link rel="modulepreload" href="${viewerUrl}"/>` : ""}
<link rel="modulepreload" href="${scriptUrl}"/>
${workerUrl ? `<link rel="preload" href="${workerUrl}" as="fetch" crossorigin="anonymous"/>` : ""}
<link rel="preload" href="${pdfUrl}" as="fetch" crossorigin="anonymous"/>
${viewerCssUrl ? `<link rel="stylesheet" href="${viewerCssUrl}"/>` : ""}
<link rel="stylesheet" href="${styleUrl}"/>
</head>
<body>
${READER_SHELL_BODY}
<script id="labshelf-boot" type="application/json">${serializeBoot(boot)}</script>
<script nonce="${n}" type="module" src="${scriptUrl}"></script>
</body>
</html>`;
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * JSON for an inert <script type="application/json"> block. `<` is escaped so a paper title containing "</script>" cannot terminate the block, and U+2028/2029 because they are line terminators in older parsers.
 * @usedBy generateHtml
 * @returns the JSON-encoded boot payload, safe to embed inside a script tag.
 */
export function serializeBoot(boot: ReaderBootParams): string {
  return JSON.stringify(boot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// A dev checkout compiled with `tsc` alone has no dist/reader; say so instead of showing a blank panel.
function bundleMissingHtml(paperTitle: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/>
<title>${escapeHtml(paperTitle)}</title>
</head>
<body style="font-family:var(--vscode-font-family,sans-serif);padding:24px;color:var(--vscode-editor-foreground)">
<h3>Reader bundle not built</h3>
<p>dist/reader/reader.js is missing. Run <code>pnpm --filter @labshelf/vscode build</code> and reopen the PDF.</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
