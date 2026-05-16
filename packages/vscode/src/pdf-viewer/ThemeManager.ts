/**
 * Maps VS Code color themes to PDF viewer themes, generates theme CSS, and persists per-paper theme preferences via PaperDataStore.
 *
 * @depends pdf-viewer/config.ts, storage/data/paperDataStore.ts, core/types.ts
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/renderer/PdfRenderer.ts, pdf-viewer/index.ts
 */
import * as vscode from "vscode";
import type { PaperDataStore } from "../storage/data/paperDataStore.js";
import type { PdfTheme } from "../core/types.js";
import { PDF_VIEWER_CONFIG } from "./config.js";

// Mapping from VS Code ColorThemeKind to pdf theme names
const VSCODE_THEME_MAP: Record<number, PdfTheme> = {
  1: 'light',   // ColorThemeKind.Light
  2: 'dark',    // ColorThemeKind.Dark
  3: 'high-contrast',  // ColorThemeKind.HighContrast
  4: 'light',   // ColorThemeKind.HighContrastLight
};

// CSS variable definitions for each theme
const THEME_CSS: Record<string, Record<string, string>> = {
  light: {
    '--pdf-bg': '#f0f0f0',
    '--pdf-canvas-bg': '#ffffff',
    '--pdf-text': '#1a1a1a',
    '--pdf-toolbar-bg': '#e8e8e8',
    '--pdf-toolbar-border': '#cccccc',
    '--pdf-toolbar-text': '#333333',
    '--pdf-btn-bg': '#d0d0d0',
    '--pdf-btn-hover-bg': '#b8b8b8',
    '--pdf-highlight-opacity': '0.4',
    '--pdf-sidebar-bg': '#f5f5f5',
    '--pdf-sidebar-border': '#ddd',
    '--pdf-canvas-filter': 'none',
  },
  dark: {
    '--pdf-bg': '#1e1e1e',
    '--pdf-canvas-bg': '#2d2d2d',
    '--pdf-text': '#d4d4d4',
    '--pdf-toolbar-bg': '#252526',
    '--pdf-toolbar-border': '#3c3c3c',
    '--pdf-toolbar-text': '#cccccc',
    '--pdf-btn-bg': '#3c3c3c',
    '--pdf-btn-hover-bg': '#505050',
    '--pdf-highlight-opacity': '0.5',
    '--pdf-sidebar-bg': '#252526',
    '--pdf-sidebar-border': '#3c3c3c',
    '--pdf-canvas-filter': 'none',
  },
  sepia: {
    '--pdf-bg': '#f4efe4',
    '--pdf-canvas-bg': '#faf6ee',
    '--pdf-text': '#4a3728',
    '--pdf-toolbar-bg': '#e8e0cc',
    '--pdf-toolbar-border': '#c8b89a',
    '--pdf-toolbar-text': '#5c4033',
    '--pdf-btn-bg': '#d4c4a0',
    '--pdf-btn-hover-bg': '#c0a878',
    '--pdf-highlight-opacity': '0.45',
    '--pdf-sidebar-bg': '#ede8d8',
    '--pdf-sidebar-border': '#c8b89a',
    '--pdf-canvas-filter': 'sepia(0.82) saturate(0.82) contrast(0.94)',
  },
  'high-contrast': {
    '--pdf-bg': '#000000',
    '--pdf-canvas-bg': '#000000',
    '--pdf-text': '#ffffff',
    '--pdf-toolbar-bg': '#000000',
    '--pdf-toolbar-border': '#ffffff',
    '--pdf-toolbar-text': '#ffffff',
    '--pdf-btn-bg': '#000000',
    '--pdf-btn-hover-bg': '#1a1a1a',
    '--pdf-highlight-opacity': '0.6',
    '--pdf-sidebar-bg': '#000000',
    '--pdf-sidebar-border': '#ffffff',
    '--pdf-canvas-filter': 'invert(1) grayscale(1) contrast(1.25)',
  },
};

function cssBlock(selector: string, vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `${selector} {\n${lines}\n}`;
}

export class ThemeManager {
  private readonly store: PaperDataStore | null;
  private themeChangeListeners: Array<(theme: string) => void> = [];
  private vsCodeThemeDisposable: vscode.Disposable | null = null;

  constructor(store?: PaperDataStore) {
    this.store = store ?? null;
  }

  /**
   * Maps a VS Code ColorThemeKind number to the corresponding PDF theme name.
   * @usedBy pdf-viewer/PdfViewerPanel.ts, pdf-viewer/ThemeManager.ts
   * @returns A PdfTheme string such as 'light', 'dark', or 'high-contrast'.
   */
  mapVsCodeTheme(kind: number): PdfTheme {
    return VSCODE_THEME_MAP[kind] ?? 'light';
  }

  /**
   * Resolves the effective theme name, converting 'auto' to the current VS Code theme name.
   * @usedBy pdf-viewer/PdfViewerPanel.ts, pdf-viewer/renderer/PdfRenderer.ts
   * @returns The resolved theme string (e.g., 'light', 'dark', 'sepia').
   */
  getEffectiveTheme(preference: string = 'auto'): string {
    if (preference === 'auto') {
      const kind = vscode.window.activeColorTheme?.kind ?? 1;
      return this.mapVsCodeTheme(kind);
    }
    if (PDF_VIEWER_CONFIG.THEMES.available.includes(preference as PdfTheme)) {
      return preference;
    }
    return 'light';
  }

  /**
   * Generates a full CSS block of theme variable definitions for both the default and all named themes.
   * @usedBy pdf-viewer/renderer/PdfRenderer.ts
   * @returns A multi-block CSS string with :root and data-pdf-theme selectors.
   */
  generateThemeCss(theme: string): string {
    const effectiveTheme = theme === 'auto' ? this.getEffectiveTheme('auto') : theme;
    const fallbackTheme = THEME_CSS[effectiveTheme] ?? THEME_CSS['light'] ?? {};
    const blocks = [cssBlock(':root', fallbackTheme)];

    for (const [themeName, vars] of Object.entries(THEME_CSS)) {
      blocks.push(cssBlock(`:root[data-pdf-theme="${themeName}"]`, vars));
    }

    return blocks.join('\n\n');
  }

  /**
   * Registers a callback to be called with the new effective theme whenever the VS Code color theme changes.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns A vscode.Disposable that unregisters the listener when disposed.
   */
  onVsCodeThemeChange(callback: (effectiveTheme: string) => void): vscode.Disposable {
    return vscode.window.onDidChangeActiveColorTheme((event) => {
      const newTheme = this.mapVsCodeTheme(event.kind);
      callback(newTheme);
    });
  }

  /**
   * Returns true when the given theme string is one of the allowed PdfTheme values.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns boolean — true if valid, false otherwise.
   */
  isValidTheme(theme: string): theme is PdfTheme {
    return PDF_VIEWER_CONFIG.THEMES.available.includes(theme as PdfTheme);
  }

  // ── Per-paper preferences (sidecar-backed) ───────────────────────────────

  /**
   * Retrieves the stored theme preference for a paper from the sidecar, defaulting to 'auto'.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns The PdfTheme preference string for the paper.
   */
  async getThemeForPaper(paperId: string): Promise<PdfTheme> {
    if (this.store) { return this.store.getTheme(paperId); }
    return 'auto';
  }

  /**
   * Persists the given theme preference to the per-paper sidecar via PaperDataStore.
   * @usedBy pdf-viewer/PdfViewerPanel.ts
   * @returns void
   */
  async setThemeForPaper(paperId: string, theme: PdfTheme): Promise<void> {
    if (this.store) { await this.store.setTheme(paperId, theme); }
  }

  dispose(): void {
    this.vsCodeThemeDisposable?.dispose();
    this.themeChangeListeners = [];
  }
}
