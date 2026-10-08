import * as vscode from 'vscode';
import { describeLibraryTextLayers, ensurePaperPdf, registerCommands } from '../../src/commands/registerCommands';
import type { ActiveServices, RequireServices } from '../../src/commands/registerCommands';
import type { PaperService } from '../../src/core/paperService';
import type { WorkspaceLogger } from '../../src/core/logger';
import type { PaperRecord } from '@labshelf/core';

// The OCR queue is driven by its own unit test; here we only need to observe
// which papers a command hands it, so stub it and keep the rest real.
jest.mock('../../src/commands/textLayerQueue', () => ({
  ...jest.requireActual('../../src/commands/textLayerQueue'),
  queueTextLayers: jest.fn(async () => undefined),
}));
import { queueTextLayers } from '../../src/commands/textLayerQueue';

function makeRequireServices(paperService?: Partial<PaperService>, logger?: Partial<WorkspaceLogger>): RequireServices {
  const ps = paperService ?? { listPapers: jest.fn(async () => []), addPapersFromUris: jest.fn(), regenerateBibTeX: jest.fn(async () => 0), reconcilePdf: jest.fn(async () => undefined) };
  const lg = logger ?? { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const tm = { getThemeForPaper: jest.fn(async () => 'auto'), setThemeForPaper: jest.fn(async () => {}), getEffectiveTheme: jest.fn(() => 'dark'), mapVsCodeTheme: jest.fn(() => 'dark'), onVsCodeThemeChange: jest.fn(() => ({ dispose: jest.fn() })), dispose: jest.fn() } as any;
  const am = { createHighlight: jest.fn(), createNote: jest.fn(), getAnnotationsByPaper: jest.fn(async () => []), deleteAnnotation: jest.fn(), updateAnnotation: jest.fn(), validatePosition: jest.fn() } as any;
  const db = { listPapers: jest.fn(async () => []), upsertPaper: jest.fn(), deletePaper: jest.fn(), appendLog: jest.fn() } as any;
  const store = { getReadingState: jest.fn(async () => null), setReadingState: jest.fn(async () => {}) } as any;
  const reindexLibrary = jest.fn(async () => ({ added: [], updated: [] }));
  return jest.fn(async () => ({ paperService: ps as PaperService, logger: lg as WorkspaceLogger, themeManager: tm, annotationManager: am, database: db, paperDataStore: store, fileSystem: {} as any, reindexLibrary }));
}

function makeNullRequireServices(): RequireServices {
  return jest.fn(async () => null);
}

function makeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('registerCommands — registration', () => {
  it('registers commands and pushes to context.subscriptions', () => {
    const ctx = makeContext();
    registerCommands(ctx, makeRequireServices());
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
  });

  it('registers labshelf.addPaper', () => {
    const ctx = makeContext();
    registerCommands(ctx, makeRequireServices());
    const cmd = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      ([name]) => name === 'labshelf.addPaper',
    );
    expect(cmd).toBeDefined();
  });

  it('registers labshelf.openSidebar', () => {
    const ctx = makeContext();
    registerCommands(ctx, makeRequireServices());
    const cmd = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      ([name]) => name === 'labshelf.openSidebar',
    );
    expect(cmd).toBeDefined();
  });
});

describe('registerCommands — library guard', () => {
  it('addPaper calls requireServices before opening dialog', async () => {
    const requireServices = makeRequireServices();
    const ctx = makeContext();
    registerCommands(ctx, requireServices);

    // Find and invoke the labshelf.addPaper handler
    const addPaperCall = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      ([name]) => name === 'labshelf.addPaper',
    );
    expect(addPaperCall).toBeDefined();
    const handler = addPaperCall[1];

    // showOpenDialog returns empty to simulate cancel
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    await handler();

    expect(requireServices).toHaveBeenCalledTimes(1);
  });

  it('addPaper returns early without dialog when requireServices returns null', async () => {
    const requireServices = makeNullRequireServices();
    const ctx = makeContext();
    registerCommands(ctx, requireServices);

    const addPaperCall = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      ([name]) => name === 'labshelf.addPaper',
    );
    const handler = addPaperCall[1];
    await handler();

    expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
  });

  it('searchLibrary returns early when requireServices returns null', async () => {
    const requireServices = makeNullRequireServices();
    const ctx = makeContext();
    registerCommands(ctx, requireServices);

    const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(
      ([name]) => name === 'labshelf.searchLibrary',
    );
    const handler = call[1];
    await handler();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });
});

describe('registerCommands — opening a paper', () => {
  const paper = { id: 'p1', title: 'A Paper', path: '/lib/papers/p1', citeKey: 'a2026', status: 'unread' as const };

  function handlerFor(name: string): (...args: unknown[]) => Promise<void> {
    const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([n]) => n === name);
    if (!call) { throw new Error(`${name} is not registered`); }
    return call[1];
  }

  it('openPaperPdf opens the LabShelf reader instead of the default PDF handler', async () => {
    registerCommands(makeContext(), makeRequireServices({ listPapers: jest.fn(async () => [paper]) }));
    await handlerFor('labshelf.openPaperPdf')('p1');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.openPdfViewer', 'p1');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode.open', expect.anything());
  });

  it('openPaperPdfExternal keeps the default handler available as an escape hatch', async () => {
    const paperService = { listPapers: jest.fn(async () => [paper]), reconcilePdf: jest.fn(async () => ({ paper, hasPdf: true })) };
    registerCommands(makeContext(), makeRequireServices(paperService));
    await handlerFor('labshelf.openPaperPdfExternal')('p1');
    const call = (vscode.commands.executeCommand as jest.Mock).mock.calls.find(([n]) => n === 'vscode.open');
    expect(call?.[1].fsPath).toBe('/lib/papers/p1/paper.pdf');
  });

  it('openPaperPdfExternal does not open a paper that has no PDF', async () => {
    const pdfless = { ...paper, hasPdf: false };
    const paperService = { listPapers: jest.fn(async () => [pdfless]), reconcilePdf: jest.fn(async () => ({ paper: pdfless, hasPdf: false })) };
    registerCommands(makeContext(), makeRequireServices(paperService));
    await handlerFor('labshelf.openPaperPdfExternal')('p1');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('vscode.open', expect.anything());
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('LabShelf: "A Paper" has no PDF yet.');
  });
});

describe('ensurePaperPdf', () => {
  const build = (over: Partial<PaperRecord>, hasPdf: boolean): ActiveServices => {
    const paper = { id: 'p1', title: 'T', path: '/lib/papers/p1', citeKey: 'k', status: 'unread' as const, ...over };
    return {
      paperService: { reconcilePdf: jest.fn(async () => ({ paper, hasPdf })) },
      logger: { log: jest.fn(async () => {}) },
    } as unknown as ActiveServices;
  };
  const anyPaper = { id: 'p1' } as PaperRecord;

  it('returns true and warns nobody when the PDF is present', async () => {
    expect(await ensurePaperPdf(build({}, true), anyPaper)).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns with "Open Link" for a DOI and opens the resolver when chosen', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Open Link');
    expect(await ensurePaperPdf(build({ doi: '10.1/x' }, false), anyPaper)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('LabShelf: "T" has no PDF yet.', 'Open Link');
    const opened = (vscode.env.openExternal as jest.Mock).mock.calls[0][0];
    expect(opened.toString()).toContain('doi.org/10.1/x');
  });

  it('warns without a link when there is no DOI or safe URL', async () => {
    expect(await ensurePaperPdf(build({}, false), anyPaper)).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('LabShelf: "T" has no PDF yet.');
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
  });
});

describe('labshelf.makeLibrarySearchable', () => {
  function handlerFor(name: string): (...args: unknown[]) => Promise<void> {
    const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([n]) => n === name);
    if (!call) { throw new Error(`${name} is not registered`); }
    return call[1];
  }

  it('leaves out papers saved without a PDF', async () => {
    const papers = [
      { id: 'a', title: 'A', path: '/a', citeKey: 'a', status: 'unread', hasPdf: true },
      { id: 'b', title: 'B', path: '/b', citeKey: 'b', status: 'unread', hasPdf: false },
      { id: 'c', title: 'C', path: '/c', citeKey: 'c', status: 'unread' },
    ];
    const paperService = { listPapers: jest.fn(async () => papers) };
    registerCommands(makeContext(), makeRequireServices(paperService as unknown as Partial<PaperService>));

    await handlerFor('labshelf.makeLibrarySearchable')();

    expect(queueTextLayers as jest.Mock).toHaveBeenCalledTimes(1);
    const passed = (queueTextLayers as jest.Mock).mock.calls[0][1] as PaperRecord[];
    expect(passed.map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('describeLibraryTextLayers', () => {
  const withLayer = (state?: string) => ({
    id: String(Math.random()), title: 't', path: '/p', citeKey: 'k', status: 'unread' as const,
    ...(state ? { textLayer: { state: state as 'native', checkedAt: 'x' } } : {}),
  });

  it('counts papers with text, made searchable, and still without text', () => {
    const papers = [withLayer('native'), withLayer('native'), withLayer('ocr'), withLayer('missing'), withLayer('failed'), withLayer()];
    expect(describeLibraryTextLayers(papers)).toBe(
      'Library checked: 2 with text, 1 made searchable by OCR, 2 without text (see the "No text" filter).',
    );
  });

  it('leaves out the groups that are empty', () => {
    expect(describeLibraryTextLayers([withLayer('native')])).toBe('Library checked: 1 with text.');
  });
});
