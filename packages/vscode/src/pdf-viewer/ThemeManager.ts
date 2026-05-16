/**
 * Module: ThemeManager
 * Responsibility: Map VS Code themes to PDF viewer themes, generate CSS, persist
 *   per-paper preferences. The per-paper sidecar JSON (PaperDataStore) is the
 *   single source of truth for theme preferences.
 * Dependencies: vscode, PaperDataStore
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

  /** Map a VS Code ColorThemeKind number to a pdf theme string */
  mapVsCodeTheme(kind: number): PdfTheme {
    return VSCODE_THEME_MAP[kind] ?? 'light';
  }

  /** Resolve the effective theme, converting 'auto' via the current VS Code theme */
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

  /** Generate CSS variable block for the given theme */
  generateThemeCss(theme: string): string {
    const effectiveTheme = theme === 'auto' ? this.getEffectiveTheme('auto') : theme;
    const fallbackTheme = THEME_CSS[effectiveTheme] ?? THEME_CSS['light'] ?? {};
    const blocks = [cssBlock(':root', fallbackTheme)];

    for (const [themeName, vars] of Object.entries(THEME_CSS)) {
      blocks.push(cssBlock(`:root[data-pdf-theme="${themeName}"]`, vars));
    }

    return blocks.join('\n\n');
  }

  /** Register a callback when VS Code theme changes. Returns a disposable. */
  onVsCodeThemeChange(callback: (effectiveTheme: string) => void): vscode.Disposable {
    return vscode.window.onDidChangeActiveColorTheme((event) => {
      const newTheme = this.mapVsCodeTheme(event.kind);
      callback(newTheme);
    });
  }

  /** Validate a theme value */
  isValidTheme(theme: string): theme is PdfTheme {
    return PDF_VIEWER_CONFIG.THEMES.available.includes(theme as PdfTheme);
  }

  // ── Per-paper preferences (sidecar-backed) ───────────────────────────────

  /** Get stored theme preference for a paper (defaults to 'auto' if not set) */
  async getThemeForPaper(paperId: string): Promise<PdfTheme> {
    if (this.store) { return this.store.getTheme(paperId); }
    return 'auto';
  }

  /** Persist theme preference to the per-paper sidecar */
  async setThemeForPaper(paperId: string, theme: PdfTheme): Promise<void> {
    if (this.store) { await this.store.setTheme(paperId, theme); }
  }

  dispose(): void {
    this.vsCodeThemeDisposable?.dispose();
    this.themeChangeListeners = [];
  }
}
