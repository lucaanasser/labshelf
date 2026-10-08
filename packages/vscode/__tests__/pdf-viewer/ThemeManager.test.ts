import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { PDF_THEMES, THEME_PRESETS, presetFor, toPageColors } from '@labshelf/core';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';

const vscode = require('vscode');

// In-memory PaperDataStore for theme-preference tests.
function makeFakeStore(): PaperDataStore {
  const files = new Map<string, string>();
  const fs = new FileSystemService();
  jest.spyOn(fs, 'ensureDirectory').mockResolvedValue(undefined);
  jest.spyOn(fs, 'writeText').mockImplementation(async (uri: any, content: string) => {
    files.set(uri.fsPath, content);
  });
  jest.spyOn(fs, 'readText').mockImplementation(async (uri: any) => {
    const v = files.get(uri.fsPath);
    if (v === undefined) { throw new Error('ENOENT'); }
    return v;
  });
  jest.spyOn(fs, 'exists').mockImplementation(async (uri: any) => files.has(uri.fsPath));
  return new PaperDataStore(vscode.Uri.file('/lib/.research'), fs);
}

describe('ThemeManager', () => {
  let manager: ThemeManager;

  beforeEach(() => {
    manager = new ThemeManager();
    // Reset mock activeColorTheme to dark
    vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Dark };
  });

  // ── mapVsCodeTheme ──────────────────────────────────────────────────────
  describe('mapVsCodeTheme', () => {
    it('maps ColorThemeKind.Light (1) to light', () => {
      expect(manager.mapVsCodeTheme(1)).toBe('light');
    });

    it('maps ColorThemeKind.Dark (2) to dark', () => {
      expect(manager.mapVsCodeTheme(2)).toBe('dark');
    });

    it('maps ColorThemeKind.HighContrast (3) to high-contrast', () => {
      expect(manager.mapVsCodeTheme(3)).toBe('high-contrast');
    });

    it('maps HighContrastLight (4) to light', () => {
      expect(manager.mapVsCodeTheme(4)).toBe('light');
    });

    it('defaults unknown kind to light', () => {
      expect(manager.mapVsCodeTheme(99)).toBe('light');
    });
  });

  // ── getEffectiveTheme ──────────────────────────────────────────────────
  describe('getEffectiveTheme', () => {
    it('resolves auto to dark when VS Code theme is dark', () => {
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Dark };
      expect(manager.getEffectiveTheme('auto')).toBe('dark');
    });

    it('resolves auto to light when VS Code theme is light', () => {
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Light };
      expect(manager.getEffectiveTheme('auto')).toBe('light');
    });

    it('returns explicit theme unchanged when valid', () => {
      expect(manager.getEffectiveTheme('sepia')).toBe('sepia');
      expect(manager.getEffectiveTheme('dark')).toBe('dark');
      expect(manager.getEffectiveTheme('high-contrast')).toBe('high-contrast');
    });

    it('falls back to light for unknown preference', () => {
      expect(manager.getEffectiveTheme('invalid-theme')).toBe('light');
    });

    it('defaults to auto resolution when no argument provided', () => {
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Light };
      expect(manager.getEffectiveTheme()).toBe('light');
    });
  });

  describe('theme presets', () => {
    it('has exactly one page-colour preset per concrete theme', () => {
      const concrete = PDF_THEMES.filter((t) => t !== 'auto').sort();
      expect(Object.keys(THEME_PRESETS).sort()).toEqual(concrete);
    });

    it('maps black-on-white to null so the light theme never recolours figures', () => {
      expect(toPageColors(THEME_PRESETS.light.bg, THEME_PRESETS.light.text)).toBeNull();
      expect(toPageColors('#FFFFFF', '#000000')).toBeNull();
      expect(toPageColors(THEME_PRESETS.dark.bg, THEME_PRESETS.dark.text)).toEqual({
        background: '#1e1e1e', foreground: '#e8e8e8',
      });
    });

    it('falls back to light for an unknown theme', () => {
      expect(presetFor('nope')).toEqual(THEME_PRESETS.light);
    });
  });

  // ── onVsCodeThemeChange ─────────────────────────────────────────────────
  describe('onVsCodeThemeChange', () => {
    it('calls the callback when VS Code theme changes', () => {
      const callback = jest.fn();
      const disposable = manager.onVsCodeThemeChange(callback);
      expect(vscode.window.onDidChangeActiveColorTheme).toHaveBeenCalled();
      disposable.dispose();
    });
  });

  // ── Sidecar-backed per-paper preferences ────────────────────────────────
  describe('getThemeForPaper / setThemeForPaper', () => {
    it('returns auto as default when no preference stored', async () => {
      const mgr = new ThemeManager(makeFakeStore());
      expect(await mgr.getThemeForPaper('paper-1')).toBe('auto');
    });

    it('persists and retrieves theme preference', async () => {
      const mgr = new ThemeManager(makeFakeStore());
      await mgr.setThemeForPaper('paper-1', 'sepia');
      expect(await mgr.getThemeForPaper('paper-1')).toBe('sepia');
    });

    it('returns auto when no store provided', async () => {
      const mgr = new ThemeManager();
      expect(await mgr.getThemeForPaper('paper-1')).toBe('auto');
    });

    it('setThemeForPaper is a no-op when no store provided', async () => {
      const mgr = new ThemeManager();
      await expect(mgr.setThemeForPaper('paper-1', 'dark')).resolves.toBeUndefined();
    });
  });
});
