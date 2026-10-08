/**
 * Maps VS Code color themes to PDF viewer themes and persists per-paper theme preferences via PaperDataStore.
 * Theme colours themselves live in core's reader/themePresets.ts (page pixels) and reader/dom/styles/reader.css (chrome).
 */
import * as vscode from "vscode";
import type { PaperDataStore } from "../storage/data/paperDataStore.js";
import { isPdfTheme, type PdfTheme } from "@labshelf/core";

// Mapping from VS Code ColorThemeKind to pdf theme names
const VSCODE_THEME_MAP: Record<number, PdfTheme> = {
  1: 'light',   // ColorThemeKind.Light
  2: 'dark',    // ColorThemeKind.Dark
  3: 'high-contrast',  // ColorThemeKind.HighContrast
  4: 'light',   // ColorThemeKind.HighContrastLight
};

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
    if (isPdfTheme(preference)) {
      return preference;
    }
    return 'light';
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

  /**
   * Releases the VS Code theme-change subscription and clears registered listeners.
   * @usedBy none currently in src (no call site wires up ThemeManager disposal yet)
   * @returns void
   */
  dispose(): void {
    this.vsCodeThemeDisposable?.dispose();
    this.themeChangeListeners = [];
  }
}
