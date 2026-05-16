import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { PaperDataStore } from '../../src/storage/paperDataStore';
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

  // ── generateThemeCss ────────────────────────────────────────────────────
  describe('generateThemeCss', () => {
    it('generates valid CSS for light theme', () => {
      const css = manager.generateThemeCss('light');
      expect(css).toContain(':root');
      expect(css).toContain('--pdf-bg');
      expect(css).toContain('--pdf-text');
      expect(css).toContain(':root[data-pdf-theme="light"]');
    });

    it('generates valid CSS for dark theme', () => {
      const css = manager.generateThemeCss('dark');
      expect(css).toContain(':root');
      expect(css).toContain('#1e1e1e');
    });

    it('generates valid CSS for sepia theme', () => {
      const css = manager.generateThemeCss('sepia');
      expect(css).toContain('#f4efe4');
    });

    it('generates valid CSS for high-contrast theme', () => {
      const css = manager.generateThemeCss('high-contrast');
      expect(css).toContain('#000000');
      expect(css).toContain('#ffffff');
    });

    it('generates selectors for all themes so the webview can switch without rerendering', () => {
      const css = manager.generateThemeCss('auto');
      expect(css).toContain(':root[data-pdf-theme="light"]');
      expect(css).toContain(':root[data-pdf-theme="dark"]');
      expect(css).toContain(':root[data-pdf-theme="sepia"]');
      expect(css).toContain(':root[data-pdf-theme="high-contrast"]');
    });

    it('resolves auto to current VS Code theme when generating CSS', () => {
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Light };
      const css = manager.generateThemeCss('auto');
      // Should use light theme values
      expect(css).toContain('#f0f0f0');
    });

    it('falls back to light for unrecognized theme name', () => {
      const css = manager.generateThemeCss('unknown');
      expect(css).toContain('#f0f0f0');
    });
  });

  // ── isValidTheme ────────────────────────────────────────────────────────
  describe('isValidTheme', () => {
    it('accepts all valid theme names', () => {
      expect(manager.isValidTheme('auto')).toBe(true);
      expect(manager.isValidTheme('light')).toBe(true);
      expect(manager.isValidTheme('dark')).toBe(true);
      expect(manager.isValidTheme('sepia')).toBe(true);
      expect(manager.isValidTheme('high-contrast')).toBe(true);
    });

    it('rejects invalid theme names', () => {
      expect(manager.isValidTheme('')).toBe(false);
      expect(manager.isValidTheme('blue')).toBe(false);
      expect(manager.isValidTheme('DARK')).toBe(false);
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
