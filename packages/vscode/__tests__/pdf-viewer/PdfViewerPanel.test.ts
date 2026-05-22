import { PdfTheme, ExtensionEventBus, EVENTS } from '@labshelf/core';
import { PdfViewerPanel } from '../../src/pdf-viewer/PdfViewerPanel';
let _paperId = 0;
function nextPaperId() { return `paper-${++_paperId}`; }
import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { AnnotationManager } from '../../src/pdf-viewer/AnnotationManager';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';

const vscode = require('vscode');

// In-memory PaperDataStore so PdfViewerPanel tests never touch disk.
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

function makePaper(overrides: Record<string, unknown> = {}) {
  const id = nextPaperId();
  return {
    id,
    title: 'Test Paper',
    path: `/papers/${id}`,
    citeKey: 'test2026',
    status: 'unread' as const,
    ...overrides,
  };
}

function makeServices() {
  const store = makeFakeStore();
  const eventBus = new ExtensionEventBus();
  const themeManager = new ThemeManager(store);
  const annotationManager = new AnnotationManager(store, eventBus);
  const paperService = {
    listPapers: jest.fn(async () => []),
  } as any;
  return { store, eventBus, themeManager, annotationManager, paperService };
}

describe('PdfViewerPanel', () => {
  beforeEach(async () => {
    PdfViewerPanel._clearAllForTesting();
    jest.clearAllMocks();
    vscode.window.activeColorTheme = { kind: 2 };
  });

  describe('createOrShow', () => {
    it('does nothing when no paper provided', () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        undefined,
      );
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('creates a webview panel when a paper is provided', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const paper = makePaper();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'labshelfPdf',
        paper.title,
        vscode.ViewColumn.Two,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
    });

    it('emits PDF_VIEWER_OPENED event when panel created', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const listener = jest.fn();
      eventBus.on(EVENTS.PDF_VIEWER_OPENED, listener);
      const paper = makePaper();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ paperId: paper.id }),
      );
    });

    it('reveals existing panel instead of creating a new one for same paper', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const paper = makePaper();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      const firstCallCount = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.length;

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      // Should not create another panel
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(firstCallCount);
    });

    it('emits PDF_VIEWER_CLOSED when panel is disposed', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const listener = jest.fn();
      eventBus.on(EVENTS.PDF_VIEWER_CLOSED, listener);
      const paper = makePaper();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
      panel.dispose();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ paperId: paper.id }),
      );
    });

    it('sets webview HTML after initialization', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        makePaper(),
      );

      // HTML is set asynchronously; wait for promise microtask queue
      await new Promise(resolve => setImmediate(resolve));

      const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
      expect(panel.webview.html).toBeTruthy();
    });

    it('applies the effective theme without rebuilding the webview when VS Code theme changes in auto mode', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        makePaper(),
      );

      await new Promise(resolve => setImmediate(resolve));

      const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
      (vscode.window as any)._fireThemeChange(vscode.ColorThemeKind.Light);

      await new Promise(resolve => setImmediate(resolve));

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'applyTheme',
          theme: 'auto',
          effectiveTheme: 'light',
        }),
      );
    });
  });

  describe('webview message handling', () => {
    async function createPanel() {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const paper = makePaper();

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      await new Promise<void>(resolve => setImmediate(resolve));

      const results = (vscode.window.createWebviewPanel as jest.Mock).mock.results;
      const panel = results[results.length - 1]?.value;
      if (!panel) { throw new Error('No panel was created'); }

      return { panel, eventBus, annotationManager, paper };
    }

    it('sets webview HTML before async theme hydration completes', async () => {
      const { paperService, eventBus, themeManager, annotationManager } = makeServices();
      const paper = makePaper();

        let resolveTheme: ((value: any) => void) | undefined;
        jest.spyOn(themeManager, 'getThemeForPaper').mockImplementation(() => new Promise<any>((resolve) => {
        resolveTheme = resolve;
      }));

      PdfViewerPanel.createOrShow(
        vscode.Uri.file('/extension'),
        paperService,
        eventBus,
        themeManager,
        annotationManager,
        paper,
      );

      const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;
      expect(panel.webview.html).toContain('data-pdf-theme="dark"');

      resolveTheme?.('sepia');
      await new Promise(resolve => setImmediate(resolve));

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'applyTheme',
          theme: 'sepia',
          effectiveTheme: 'sepia',
        }),
      );
    });

    it('handles pageChanged message', async () => {
      const { panel } = await createPanel();
      // Simulate pageChanged message from webview
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 3 });
      // No error thrown is the assertion here
    });

    it('handles zoomChanged message', async () => {
      const { panel } = await createPanel();
      panel.webview._fireMessage({ command: 'zoomChanged', zoomLevel: 150 });
    });

    it('handles createAnnotation message and updates webview', async () => {
      const { panel, annotationManager, paper } = await createPanel();
      const createSpy = jest.spyOn(annotationManager, 'createHighlight');

      panel.webview._fireMessage({
        command: 'createAnnotation',
        type: 'highlight',
        pageNumber: 1,
        content: 'test highlight',
        color: 'yellow',
        position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      });

      await new Promise(resolve => setImmediate(resolve));
      expect(createSpy).toHaveBeenCalledWith(
        paper.id, 1, 'test highlight', 'yellow',
        expect.objectContaining({ x: 0.1 }),
      );
    });

    it('handles deleteAnnotation message', async () => {
      const { panel, annotationManager, paper } = await createPanel();
      // Create an annotation first
      const ann = await annotationManager.createHighlight(
        paper.id, 1, 'to delete', 'green',
        { x: 0, y: 0, width: 0.1, height: 0.1 },
      );
      const deleteSpy = jest.spyOn(annotationManager, 'deleteAnnotation');

      panel.webview._fireMessage({ command: 'deleteAnnotation', id: ann.id });
      await new Promise(resolve => setImmediate(resolve));

      expect(deleteSpy).toHaveBeenCalledWith(ann.id, paper.id);
    });
  });
});
