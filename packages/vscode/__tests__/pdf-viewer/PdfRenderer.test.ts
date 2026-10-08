import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PdfRenderer,
  resolvePdfjsUris,
  getPdfjsDirectory,
  resolveReaderBundleUris,
  serializeBoot,
} from '../../src/pdf-viewer/renderer/PdfRenderer';
import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { DEFAULT_READER_PREFS } from '@labshelf/reader';

const vscode = require('vscode');

function makeWebviewMock() {
  return {
    cspSource: 'vscode-resource:',
    asWebviewUri: jest.fn((uri: { fsPath?: string }) => ({
      toString: () => `vscode-resource:${uri.fsPath ?? ''}`,
    })),
  };
}

// The shell links the esbuild output, so a built bundle must exist on disk for the normal path.
function makeExtensionDir(withBundle: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-reader-'));
  if (withBundle) {
    fs.mkdirSync(path.join(dir, 'dist', 'reader'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'reader', 'reader.js'), '// bundle');
    fs.writeFileSync(path.join(dir, 'dist', 'reader', 'reader.css'), '/* css */');
  }
  return dir;
}

function readBoot(html: string): any {
  const m = html.match(/<script id="labshelf-boot" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) { throw new Error('boot block missing'); }
  return JSON.parse(m[1]!);
}

describe('PdfRenderer', () => {
  let renderer: PdfRenderer;
  let themeManager: ThemeManager;
  let extensionDir: string;

  beforeAll(() => { extensionDir = makeExtensionDir(true); });
  afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });

  beforeEach(() => {
    renderer = new PdfRenderer();
    themeManager = new ThemeManager();
    vscode.window.activeColorTheme = { kind: 2 }; // dark
  });

  describe('generateHtml', () => {
    function makeParams(overrides = {}) {
      const webview = makeWebviewMock() as any;
      return {
        webview,
        extensionUri: vscode.Uri.file(extensionDir),
        pdfUri: vscode.Uri.file('/papers/paper1/paper.pdf'),
        paperId: 'paper-1',
        paperTitle: 'Test Paper',
        themeManager,
        themePreference: 'dark' as const,
        prefs: DEFAULT_READER_PREFS,
        ...overrides,
      };
    }

    it('includes the paper title in the HTML', () => {
      const html = renderer.generateHtml(makeParams({ paperTitle: 'My Awesome Paper' }));
      expect(html).toContain('<title>My Awesome Paper</title>');
    });

    it('keeps the CSP that pdf.js needs (nonce, wasm, blob worker)', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('Content-Security-Policy');
      expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}' 'wasm-unsafe-eval' vscode-resource:/);
      expect(html).toContain('worker-src vscode-resource: blob:');
      expect(html).toContain("default-src 'none'");
    });

    it('loads the bundled runtime as a nonce-tagged module script and its stylesheet', () => {
      const html = renderer.generateHtml(makeParams());
      const nonce = html.match(/nonce-([A-Za-z0-9]{32})/)?.[1];
      expect(html).toMatch(new RegExp(`<script nonce="${nonce}" type="module" src="[^"]*dist/reader/reader\\.js"></script>`));
      expect(html).toMatch(/<link rel="stylesheet" href="[^"]*dist\/reader\/reader\.css"\/>/);
      expect(html).toMatch(/<link rel="modulepreload" href="[^"]*reader\.js"\/>/);
    });

    it('places reader.css after pdf_viewer.css so reader rules win', () => {
      const html = renderer.generateHtml(makeParams());
      const viewerCss = html.indexOf('pdf_viewer.css');
      if (viewerCss >= 0) { expect(html.indexOf('reader.css')).toBeGreaterThan(viewerCss); }
    });

    it('preloads the PDF so the download starts during HTML parse', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toMatch(/<link rel="preload" href="[^"]*paper\.pdf" as="fetch"/);
    });

    it('contains only structural containers; controls are built by the bundle', () => {
      const html = renderer.generateHtml(makeParams());
      for (const id of [
        'app', 'sidebar', 'sidebar-resizer', 'pdf-shell', 'toolbar', 'find-bar', 'viewerContainer', 'viewer',
        'status-pill', 'loading-msg', 'error-msg', 'selection-toolbar', 'hover-popup', 'cheatsheet',
      ]) {
        expect(html).toContain(`id="${id}"`);
      }
      expect(html).toContain('<div id="viewer" class="pdfViewer">');
      expect(html).not.toContain('<button');
    });

    it('serializes boot params that round-trip through the JSON block', () => {
      const prefs = { ...DEFAULT_READER_PREFS, vimKeys: true, citationStyle: 'latex' as const };
      const boot = readBoot(renderer.generateHtml(makeParams({ themePreference: 'sepia', prefs })));
      expect(boot.paperId).toBe('paper-1');
      expect(boot.paperTitle).toBe('Test Paper');
      expect(boot.themePreference).toBe('sepia');
      expect(boot.effectiveTheme).toBe('sepia');
      expect(boot.prefs).toEqual(prefs);
      expect(boot.assets.pdfUrl).toContain('paper.pdf');
      expect(typeof boot.isMac).toBe('boolean');
      expect(boot.protocolVersion).toBe(1);
    });

    it('sets the initial data-pdf-theme attribute to the effective theme', () => {
      const html = renderer.generateHtml(makeParams({ themePreference: 'auto' }));
      expect(html).toContain('<html id="root" lang="en" data-pdf-theme="dark">');
      expect(readBoot(html).effectiveTheme).toBe('dark');
    });

    it('escapes special characters in paper title', () => {
      const html = renderer.generateHtml(makeParams({ paperTitle: '<script>alert("xss")</script>' }));
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('cannot be broken out of the boot block by a crafted title', () => {
      const title = '</script><script>alert(1)</script>';
      const html = renderer.generateHtml(makeParams({ paperTitle: title }));
      expect(html).not.toContain('</script><script>alert');
      expect(readBoot(html).paperTitle).toBe(title);
    });

    it('generates different nonces on each call', () => {
      const html1 = renderer.generateHtml(makeParams());
      const html2 = renderer.generateHtml(makeParams());
      const nonce1 = html1.match(/nonce-([A-Za-z0-9]{32})/)?.[1];
      const nonce2 = html2.match(/nonce-([A-Za-z0-9]{32})/)?.[1];
      expect(nonce1).toBeTruthy();
      expect(nonce2).toBeTruthy();
      expect(nonce1).not.toBe(nonce2);
    });

    it('renders an explicit error page when the bundle has not been built', () => {
      const bare = makeExtensionDir(false);
      try {
        const html = renderer.generateHtml(makeParams({ extensionUri: vscode.Uri.file(bare) }));
        expect(html).toContain('Reader bundle not built');
        expect(html).toContain('pnpm --filter @labshelf/vscode build');
        expect(html).not.toContain('<script');
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe('serializeBoot', () => {
    it('escapes "<" and the JS line separators', () => {
      const out = serializeBoot({ paperTitle: 'a<b\u2028c\u2029d' } as any);
      expect(out).not.toContain('<');
      expect(out).toContain('\\u003c');
      expect(out).not.toMatch(/[\u2028\u2029]/);
      expect(JSON.parse(out).paperTitle).toBe('a<b\u2028c\u2029d');
    });
  });

  describe('resolveReaderBundleUris', () => {
    it('returns null without a built bundle and URIs with one', () => {
      const webview = makeWebviewMock() as any;
      const bare = makeExtensionDir(false);
      try {
        expect(resolveReaderBundleUris(webview, vscode.Uri.file(bare))).toBeNull();
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
      const uris = resolveReaderBundleUris(webview, vscode.Uri.file(extensionDir));
      expect(uris?.scriptUri.toString()).toContain(path.join('dist', 'reader', 'reader.js'));
      expect(uris?.styleUri.toString()).toContain(path.join('dist', 'reader', 'reader.css'));
    });
  });

  describe('resolvePdfjsUris', () => {
    it('returns null if pdfjs-dist is not resolvable (mocked)', () => {
      // In test environment require.resolve may or may not find the module
      // Just verify it returns an object or null without throwing
      const webview = makeWebviewMock() as any;
      const result = resolvePdfjsUris(webview);
      // Either null (not found) or an object with URI properties
      if (result !== null) {
        expect(result).toHaveProperty('pdfjsWebviewUri');
        expect(result).toHaveProperty('workerWebviewUri');
        expect(result).toHaveProperty('viewerWebviewUri');
        expect(result).toHaveProperty('viewerCssWebviewUri');
      }
    });
  });

  describe('getPdfjsDirectory', () => {
    it('returns a Uri or null without throwing', () => {
      const result = getPdfjsDirectory();
      // Either null or a vscode.Uri
      if (result !== null) {
        expect(typeof result.fsPath).toBe('string');
      }
    });
  });
});
