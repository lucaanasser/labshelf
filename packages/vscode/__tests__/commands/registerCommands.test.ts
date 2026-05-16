import * as vscode from 'vscode';
import { registerCommands } from '../../src/commands/registerCommands';
import type { RequireServices } from '../../src/commands/registerCommands';
import type { PaperService } from '../../src/core/paperService';
import type { WorkspaceLogger } from '../../src/core/logger';

function makeRequireServices(paperService?: Partial<PaperService>, logger?: Partial<WorkspaceLogger>): RequireServices {
  const ps = paperService ?? { listPapers: jest.fn(async () => []), addPapersFromUris: jest.fn(), regenerateBibTeX: jest.fn(async () => 0) };
  const lg = logger ?? { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const tm = { getThemeForPaper: jest.fn(async () => 'auto'), setThemeForPaper: jest.fn(async () => {}), isValidTheme: jest.fn(() => true), getEffectiveTheme: jest.fn(() => 'dark'), generateThemeCss: jest.fn(() => ''), mapVsCodeTheme: jest.fn(() => 'dark'), onVsCodeThemeChange: jest.fn(() => ({ dispose: jest.fn() })), dispose: jest.fn() } as any;
  const am = { createHighlight: jest.fn(), createNote: jest.fn(), getAnnotationsByPaper: jest.fn(async () => []), deleteAnnotation: jest.fn(), updateAnnotation: jest.fn(), validatePosition: jest.fn() } as any;
  return jest.fn(async () => ({ paperService: ps as PaperService, logger: lg as WorkspaceLogger, themeManager: tm, annotationManager: am }));
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
