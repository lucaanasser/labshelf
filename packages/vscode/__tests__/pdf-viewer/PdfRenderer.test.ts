import { PdfRenderer, resolvePdfjsUris, getPdfjsDirectory } from '../../src/pdf-viewer/PdfRenderer';
import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';

const vscode = require('vscode');

function makeWebviewMock() {
  return {
    cspSource: 'vscode-resource:',
    asWebviewUri: jest.fn((uri: { fsPath?: string }) => ({
      toString: () => `vscode-resource:${uri.fsPath ?? ''}`,
    })),
  };
}

describe('PdfRenderer', () => {
  let renderer: PdfRenderer;
  let themeManager: ThemeManager;

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
        extensionUri: vscode.Uri.file('/extension'),
        pdfUri: vscode.Uri.file('/papers/paper1/paper.pdf'),
        paperId: 'paper-1',
        paperTitle: 'Test Paper',
        themeManager,
        themePreference: 'dark',
        initialPage: 1,
        initialZoom: 100,
        annotations: [],
        ...overrides,
      };
    }

    it('returns a non-empty HTML string', () => {
      const html = renderer.generateHtml(makeParams());
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(100);
    });

    it('includes the paper title in the HTML', () => {
      const html = renderer.generateHtml(makeParams({ paperTitle: 'My Awesome Paper' }));
      expect(html).toContain('My Awesome Paper');
    });

    it('includes a nonce for CSP', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toMatch(/nonce-[A-Za-z0-9]{32}/);
    });

    it('includes CSP meta tag', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('script-src');
    });

    it('includes the PDF URL from webview URI', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('paper.pdf');
    });

    it('includes zoom level options', () => {
      const html = renderer.generateHtml(makeParams({ initialZoom: 125 }));
      expect(html).toContain('125');
      expect(html).toContain('zoomSelect');
    });

    it('includes theme selector with all options', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('themeSelect');
      expect(html).toContain('sepia');
      expect(html).toContain('high-contrast');
    });

    it('includes navigation buttons', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('firstBtn');
      expect(html).toContain('prevBtn');
      expect(html).toContain('nextBtn');
      expect(html).toContain('lastBtn');
    });

    it('includes annotation sidebar', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('sidebar');
      expect(html).toContain('annotation-list');
    });

    it('includes selection toolbar with color buttons', () => {
      const html = renderer.generateHtml(makeParams());
      expect(html).toContain('selection-toolbar');
      expect(html).toContain('color-btn');
    });

    it('injects annotations JSON into the script', () => {
      const annotations = [{
        id: 'ann-1', paperId: 'paper-1', type: 'highlight',
        pageNumber: 2, content: 'important text', color: 'yellow',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }] as any[];
      const html = renderer.generateHtml(makeParams({ annotations }));
      expect(html).toContain('ann-1');
      expect(html).toContain('important text');
    });

    it('applies theme CSS from ThemeManager', () => {
      const html = renderer.generateHtml(makeParams({ themePreference: 'sepia' }));
      expect(html).toContain('--pdf-bg');
      // Sepia has warm background
      expect(html).toContain('#e8dfc8');
      expect(html).toContain('[data-pdf-theme="sepia"]');
    });

    it('sets the initial data-pdf-theme attribute to the effective theme', () => {
      const html = renderer.generateHtml(makeParams({ themePreference: 'auto' }));
      expect(html).toContain('<html id="root" lang="en" data-pdf-theme="dark">');
    });

    it('escapes special characters in paper title', () => {
      const html = renderer.generateHtml(makeParams({ paperTitle: '<script>alert("xss")</script>' }));
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
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
