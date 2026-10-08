import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ExtensionEventBus, EVENTS } from '@labshelf/core';
import { PdfViewerPanel, type PdfViewerDeps } from '../../src/pdf-viewer/PdfViewerPanel';
import { ThemeManager } from '../../src/pdf-viewer/ThemeManager';
import { AnnotationManager } from '../../src/pdf-viewer/AnnotationManager';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';

const vscode = require('vscode');

let _paperId = 0;
function nextPaperId() { return `paper-${++_paperId}`; }

// In-memory PaperDataStore so PdfViewerPanel tests never touch disk.
function makeFakeStore(): PaperDataStore {
  const files = new Map<string, string>();
  const fsService = new FileSystemService();
  jest.spyOn(fsService, 'ensureDirectory').mockResolvedValue(undefined);
  jest.spyOn(fsService, 'writeText').mockImplementation(async (uri: any, content: string) => {
    files.set(uri.fsPath, content);
  });
  jest.spyOn(fsService, 'readText').mockImplementation(async (uri: any) => {
    const v = files.get(uri.fsPath);
    if (v === undefined) { throw new Error('ENOENT'); }
    return v;
  });
  jest.spyOn(fsService, 'exists').mockImplementation(async (uri: any) => files.has(uri.fsPath));
  return new PaperDataStore(vscode.Uri.file('/lib/.research'), fsService);
}

function makePaper(overrides: Record<string, unknown> = {}) {
  const id = nextPaperId();
  return {
    id,
    title: 'Test Paper',
    path: `/papers/${id}`,
    citeKey: 'test2026',
    authors: ['Ana Silva', 'Rui Costa', 'Li Wei'],
    year: 2026,
    status: 'unread' as const,
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PdfViewerPanel', () => {
  let extensionDir: string;

  beforeAll(() => {
    extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-panel-'));
    fs.mkdirSync(path.join(extensionDir, 'dist', 'reader'), { recursive: true });
    fs.writeFileSync(path.join(extensionDir, 'dist', 'reader', 'reader.js'), '// bundle');
  });
  afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });

  beforeEach(() => {
    PdfViewerPanel._clearAllForTesting();
    jest.clearAllMocks();
    vscode.window.activeColorTheme = { kind: 2 };
    for (const key of Object.keys(vscode.workspace._config)) { delete vscode.workspace._config[key]; }
  });

  function makeDeps(overrides: Partial<PdfViewerDeps> = {}) {
    const store = makeFakeStore();
    const eventBus = new ExtensionEventBus();
    const themeManager = new ThemeManager(store);
    const annotationManager = new AnnotationManager(store, eventBus);
    const logger = { log: jest.fn(async () => {}) } as any;
    const onReadingEvent = jest.fn();
    const deps: PdfViewerDeps = {
      extensionUri: vscode.Uri.file(extensionDir),
      eventBus,
      themeManager,
      annotationManager,
      readingStore: store,
      logger,
      onReadingEvent,
      ...overrides,
    };
    return { deps, store, eventBus, themeManager, annotationManager, logger, onReadingEvent };
  }

  function lastPanel() {
    const results = (vscode.window.createWebviewPanel as jest.Mock).mock.results;
    const panel = results[results.length - 1]?.value;
    if (!panel) { throw new Error('No panel was created'); }
    return panel;
  }

  function open(overrides: Partial<PdfViewerDeps> = {}, paperOverrides: Record<string, unknown> = {}) {
    const ctx = makeDeps(overrides);
    const paper = makePaper(paperOverrides);
    PdfViewerPanel.createOrShow(ctx.deps, paper);
    return { ...ctx, paper, panel: lastPanel() };
  }

  const posted = (panel: any, type: string) =>
    (panel.webview.postMessage as jest.Mock).mock.calls.map((c) => c[0]).filter((m) => m.type === type);

  describe('createOrShow', () => {
    it('creates a script-enabled panel in the active group by default', () => {
      const { paper } = open();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'labshelfPdf',
        paper.title,
        vscode.ViewColumn.Active,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('opens beside the editor when labshelf.reader.openBeside is true', () => {
      vscode.workspace._config['labshelf.reader'] = { openBeside: true };
      open();
      expect((vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[2]).toBe(vscode.ViewColumn.Two);
    });

    it('never enables the VS Code find widget, which would swallow Ctrl+F', () => {
      open();
      const options = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[3];
      expect(options.enableFindWidget).toBeUndefined();
    });

    it('restricts localResourceRoots to the bundle, the paper folder and pdf.js', () => {
      const { paper } = open();
      const roots: string[] = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.at(-1)[3]
        .localResourceRoots.map((u: any) => u.fsPath);
      expect(roots).toContain(path.join(extensionDir, 'dist', 'reader'));
      expect(roots).toContain(paper.path);
      expect(roots).not.toContain(extensionDir);
    });

    it('assigns the HTML shell synchronously, before any disk access', () => {
      const ctx = makeDeps();
      jest.spyOn(ctx.themeManager, 'getThemeForPaper').mockImplementation(() => new Promise(() => {}));
      PdfViewerPanel.createOrShow(ctx.deps, makePaper());
      const html: string = lastPanel().webview.html;
      expect(html).toContain('data-pdf-theme="dark"');
      expect(html).toContain(path.join('dist', 'reader', 'reader.js'));
    });

    it('emits PDF_VIEWER_OPENED and PDF_VIEWER_CLOSED', () => {
      const ctx = makeDeps();
      const opened = jest.fn();
      const closed = jest.fn();
      ctx.eventBus.on(EVENTS.PDF_VIEWER_OPENED, opened);
      ctx.eventBus.on(EVENTS.PDF_VIEWER_CLOSED, closed);
      const paper = makePaper();
      PdfViewerPanel.createOrShow(ctx.deps, paper);
      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ paperId: paper.id }));
      lastPanel().dispose();
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ paperId: paper.id }));
    });

    it('reveals the existing panel and scrolls it to a requested page', () => {
      const { deps, paper, panel } = open();
      const created = (vscode.window.createWebviewPanel as jest.Mock).mock.calls.length;
      PdfViewerPanel.createOrShow(deps, paper, { page: 7 });
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(created);
      expect(panel.reveal).toHaveBeenCalled();
      expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 7 }]);
    });

    it('delivers a page requested at open time once the webview is ready', async () => {
      const ctx = makeDeps();
      PdfViewerPanel.createOrShow(ctx.deps, makePaper(), { page: 4 });
      const panel = lastPanel();
      expect(posted(panel, 'scrollToPage')).toHaveLength(0);
      panel.webview._fireMessage({ command: 'ready', totalPages: 10 });
      await flush();
      expect(posted(panel, 'scrollToPage')).toEqual([{ type: 'scrollToPage', pageNumber: 4 }]);
    });

    it('applies the effective theme without rebuilding the webview when VS Code theme changes in auto mode', async () => {
      const { panel } = open();
      const html = panel.webview.html;
      (vscode.window as any)._fireThemeChange(vscode.ColorThemeKind.Light);
      await flush();
      expect(posted(panel, 'applyTheme')).toContainEqual({ type: 'applyTheme', theme: 'auto', effectiveTheme: 'light' });
      expect(panel.webview.html).toBe(html);
    });

    it('pushes new preferences when labshelf.reader settings change', async () => {
      const { panel } = open();
      vscode.workspace._config['labshelf.reader'] = { vimKeys: true };
      vscode.workspace._fireConfigChange('labshelf.reader.vimKeys');
      await flush();
      expect(posted(panel, 'prefsChanged')[0].prefs.vimKeys).toBe(true);
    });
  });

  describe('init handshake', () => {
    it('replies to ready-for-init with theme, annotations, prefs and the stored reading position', async () => {
      const { panel, store, annotationManager, paper } = open();
      await store.setTheme(paper.id, 'sepia');
      await annotationManager.createHighlight(paper.id, 2, 'a highlight', 'green');
      const reading = { page: 5, scaleValue: 'page-width', top: 300, left: 0, updatedAt: '2026-01-01T00:00:00.000Z' };
      await store.setReadingState(paper.id, reading);

      panel.webview._fireMessage({ command: 'ready-for-init' });
      await flush();
      await flush();

      const [init] = posted(panel, 'init');
      expect(init.theme).toBe('sepia');
      expect(init.effectiveTheme).toBe('sepia');
      expect(init.reading).toEqual(reading);
      expect(init.annotations).toHaveLength(1);
      expect(init.prefs.defaultZoom).toBe('page-width');
    });

    it('sends reading: null for a paper that was never opened', async () => {
      const { panel } = open();
      panel.webview._fireMessage({ command: 'ready-for-init' });
      await flush();
      await flush();
      expect(posted(panel, 'init')[0].reading).toBeNull();
    });
  });

  describe('webview message handling', () => {
    it('ignores malformed messages and logs a warning', async () => {
      const { panel, logger, store, paper } = open();
      const setSpy = jest.spyOn(store, 'setReadingState');
      panel.webview._fireMessage({ command: 'saveReadingState' });
      panel.webview._fireMessage({ command: 'nope' });
      panel.webview._fireMessage('garbage');
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 'three' });
      await flush();
      expect(setSpy).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('WARN', 'pdf-viewer', expect.any(String), { paperId: paper.id });
    });

    it('logs the open timeline from a perf message', async () => {
      const { panel, logger } = open();
      panel.webview._fireMessage({ command: 'perf', timeline: { scriptStart: 1 }, pageNumber: 1, theme: 'dark', dpr: 2, canvas: '10x10' });
      await flush();
      expect(logger.log).toHaveBeenCalledWith('INFO', 'pdf-viewer', 'PDF open timeline', expect.objectContaining({
        timeline: { scriptStart: 1 }, hostMs: expect.any(Number),
      }));
    });

    it('persists a valid reading state and drops a corrupt one', async () => {
      const { panel, store, paper } = open();
      panel.webview._fireMessage({ command: 'saveReadingState', state: { page: 0, scaleValue: 'huge' } });
      await flush();
      expect(await store.getReadingState(paper.id)).toBeNull();

      panel.webview._fireMessage({
        command: 'saveReadingState',
        state: { page: 3, scaleValue: '1.25', top: 120, sidebar: { open: true, tab: 'outline', width: 9999 }, updatedAt: 'x' },
      });
      await flush();
      await flush();
      const saved = await store.getReadingState(paper.id);
      expect(saved).toMatchObject({ page: 3, scaleValue: '1.25', top: 120 });
      expect(saved?.sidebar).toEqual({ open: true, tab: 'outline', width: 480 });
    });

    it('persists the selected theme and echoes applyTheme', async () => {
      const { panel, store, paper } = open();
      panel.webview._fireMessage({ command: 'selectTheme', theme: 'sepia' });
      await flush();
      await flush();
      expect(await store.getTheme(paper.id)).toBe('sepia');
      expect(posted(panel, 'applyTheme')).toContainEqual({ type: 'applyTheme', theme: 'sepia', effectiveTheme: 'sepia' });
    });

    it('rejects an unknown theme', async () => {
      const { panel, store, paper } = open();
      panel.webview._fireMessage({ command: 'selectTheme', theme: 'neon' });
      await flush();
      expect(await store.getTheme(paper.id)).toBe('auto');
    });

    it('creates a highlight and sends the refreshed list', async () => {
      const { panel, annotationManager, paper } = open();
      const createSpy = jest.spyOn(annotationManager, 'createHighlight');
      panel.webview._fireMessage({
        command: 'createAnnotation', type: 'highlight', pageNumber: 1, content: 'test highlight', color: 'yellow',
        position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      });
      await flush();
      await flush();
      expect(createSpy).toHaveBeenCalledWith(paper.id, 1, 'test highlight', 'yellow', expect.objectContaining({ x: 0.1 }));
      expect(posted(panel, 'updateAnnotations').at(-1).annotations).toHaveLength(1);
    });

    it('deletes an annotation', async () => {
      const { panel, annotationManager, paper } = open();
      const ann = await annotationManager.createHighlight(paper.id, 1, 'to delete', 'green');
      const deleteSpy = jest.spyOn(annotationManager, 'deleteAnnotation');
      panel.webview._fireMessage({ command: 'deleteAnnotation', id: ann.id });
      await flush();
      await flush();
      expect(deleteSpy).toHaveBeenCalledWith(ann.id, paper.id);
      expect(posted(panel, 'updateAnnotations').at(-1).annotations).toHaveLength(0);
    });

    it.each([
      ['pandoc', '> A quoted passage.\n\n[@test2026, p. 12]'],
      ['latex', "``A quoted passage.'' \\cite[p.~12]{test2026}"],
      ['author-year', '"A quoted passage." (Silva et al., 2026, p. 12)'],
      ['citekey', 'A quoted passage. @test2026'],
    ])('copies a selection with a %s citation', async (style, expected) => {
      vscode.workspace._config['labshelf.reader'] = { citationStyle: style };
      const { panel } = open();
      panel.webview._fireMessage({ command: 'copyWithCitation', text: 'A quoted\npassage.', pageNumber: 12 });
      await flush();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(expected);
    });

    it('copies plain text', async () => {
      const { panel } = open();
      panel.webview._fireMessage({ command: 'copyText', text: '[1] A. Author. Title.' });
      await flush();
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('[1] A. Author. Title.');
    });

    it('exports annotations as Markdown to the clipboard', async () => {
      const { panel, annotationManager, paper } = open();
      await annotationManager.createHighlight(paper.id, 3, 'key finding', 'blue');
      panel.webview._fireMessage({ command: 'exportAnnotations', target: 'clipboard' });
      await flush();
      await flush();
      const markdown = (vscode.env.clipboard.writeText as jest.Mock).mock.calls.at(-1)[0] as string;
      expect(markdown).toContain('# Test Paper');
      expect(markdown).toContain('## Page 3');
      expect(markdown).toContain('> key finding');
    });

    it('exports annotations to the file chosen in the save dialog, defaulting to the paper folder', async () => {
      const { panel, paper } = open();
      const target = vscode.Uri.file('/tmp/out/annotations.md');
      (vscode.window.showSaveDialog as jest.Mock).mockResolvedValueOnce(target);
      panel.webview._fireMessage({ command: 'exportAnnotations', target: 'file' });
      await flush();
      await flush();
      const dialogOptions = (vscode.window.showSaveDialog as jest.Mock).mock.calls.at(-1)[0];
      expect(dialogOptions.defaultUri.fsPath).toBe(path.join(paper.path, 'annotations.md'));
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(target, expect.anything());
    });

    it('writes nothing when the save dialog is cancelled', async () => {
      const { panel } = open();
      panel.webview._fireMessage({ command: 'exportAnnotations', target: 'file' });
      await flush();
      await flush();
      expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });

    it('opens http(s) and mailto links externally and blocks every other scheme', async () => {
      const { panel } = open();
      for (const url of ['https://doi.org/10.1/x', 'mailto:a@b.org']) {
        panel.webview._fireMessage({ command: 'openExternalLink', url });
      }
      for (const url of ['file:///etc/passwd', 'command:workbench.action.terminal.new', 'vscode://x/y', 'javascript:alert(1)', 'not a url']) {
        panel.webview._fireMessage({ command: 'openExternalLink', url });
      }
      await flush();
      expect(vscode.env.openExternal).toHaveBeenCalledTimes(2);
    });
  });

  describe('postToActive', () => {
    it('targets the focused reader and nothing once it loses focus', () => {
      const first = open();
      const second = open();
      first.panel._fireViewState({ active: false, visible: true });
      second.panel._fireViewState({ active: true, visible: true });
      expect(PdfViewerPanel.postToActive('zoomIn')).toBe(true);
      expect(posted(second.panel, 'command')).toEqual([{ type: 'command', id: 'zoomIn' }]);
      expect(posted(first.panel, 'command')).toHaveLength(0);

      second.panel._fireViewState({ active: false, visible: true });
      expect(PdfViewerPanel.postToActive('find')).toBe(false);
    });

    it('returns false after the focused panel is closed', () => {
      const { panel } = open();
      panel._fireViewState({ active: true, visible: true });
      panel.dispose();
      expect(PdfViewerPanel.postToActive('zoomOut')).toBe(false);
    });
  });

  describe('reading events', () => {
    afterEach(() => { jest.useRealTimers(); });

    it('records open, page dwell of at least five seconds, annotate and close', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { panel, onReadingEvent, paper } = open();

      panel.webview._fireMessage({ command: 'ready', totalPages: 9 });
      await flush();
      jest.setSystemTime(new Date('2026-01-01T00:00:02Z'));
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 2 }); // 2 s on page 1: skimmed
      await flush();
      jest.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 3 }); // 8 s on page 2: read
      await flush();
      panel.webview._fireMessage({ command: 'createAnnotation', type: 'highlight', pageNumber: 3, content: 'x', color: 'red' });
      await flush();
      await flush();
      panel.dispose();

      const events = onReadingEvent.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.kind)).toEqual(['open', 'scroll', 'annotate', 'close']);
      expect(events[1]).toMatchObject({ paperId: paper.id, page: 2, durationMs: 8000 });
      expect(events[3]).toMatchObject({ kind: 'close', page: 3 });
    });

    it('does not count time while the panel is hidden', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { panel, onReadingEvent } = open();
      panel.webview._fireMessage({ command: 'ready', totalPages: 9 });
      await flush();
      jest.setSystemTime(new Date('2026-01-01T00:00:01Z'));
      panel._fireViewState({ active: false, visible: false });
      jest.setSystemTime(new Date('2026-01-01T01:00:00Z'));
      panel._fireViewState({ active: true, visible: true });
      jest.setSystemTime(new Date('2026-01-01T01:00:02Z'));
      panel.webview._fireMessage({ command: 'pageChanged', pageNumber: 2 });
      await flush();
      expect(onReadingEvent.mock.calls.map((c) => c[0].kind)).toEqual(['open']);
    });

    it('survives a throwing analytics sink', async () => {
      const { panel } = open({ onReadingEvent: () => { throw new Error('db closed'); } });
      panel.webview._fireMessage({ command: 'ready', totalPages: 1 });
      await flush();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });
});
