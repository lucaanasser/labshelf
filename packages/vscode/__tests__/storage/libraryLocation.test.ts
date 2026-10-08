import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { ILogger } from '@labshelf/core';
import { readSharedLibraryRoot, sharedConfigPath, updateSharedConfig } from '@labshelf/core/node';
import {
  mirrorLibraryRoot,
  resolveLibraryRoot,
  persistLibraryRoot,
  ensureLibraryStructure,
  runLibrarySetupWizard,
} from '../../src/storage/paths/libraryLocation';
import { VscodeFileSystem } from '../../src/storage/vscodeFileSystem';

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

function makeContext(stored?: string): vscode.ExtensionContext {
  const state = new Map<string, unknown>(stored ? [['labshelf.libraryRoot', stored]] : []);
  return {
    globalState: {
      get: (key: string) => state.get(key),
      update: jest.fn(async (key: string, value: unknown) => { state.set(key, value); }),
    },
  } as unknown as vscode.ExtensionContext;
}

function makeLogger(): ILogger & { error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
}

const fsService = new VscodeFileSystem('/tmp/mylib/.research/tmp');
const createFileSystem = () => fsService;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── resolveLibraryRoot ────────────────────────────────────────────────────────

describe('resolveLibraryRoot', () => {
  it('returns undefined when globalState has no stored path', async () => {
    const ctx = makeContext();
    const result = await resolveLibraryRoot(ctx);
    expect(result).toBeUndefined();
  });

  it('returns undefined when the stored path is not a directory', async () => {
    const ctx = makeContext('/tmp/some-path');
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
    const result = await resolveLibraryRoot(ctx);
    expect(result).toBeUndefined();
  });

  it('returns undefined when stat throws (path inaccessible)', async () => {
    const ctx = makeContext('/tmp/nonexistent');
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    const result = await resolveLibraryRoot(ctx);
    expect(result).toBeUndefined();
  });

  it('returns a Uri when stored path is a valid directory', async () => {
    const ctx = makeContext('/tmp/library');
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    const result = await resolveLibraryRoot(ctx);
    expect(result).toBeDefined();
    expect(result!.fsPath).toBe('/tmp/library');
  });
});

describe('resolveLibraryRoot and the shared config', () => {
  it('adopts a library set up in the terminal app when VS Code has none', async () => {
    await updateSharedConfig({ libraryRoot: '/Users/me/FromTerminal' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    const root = await resolveLibraryRoot(makeContext());
    expect(root?.fsPath).toBe('/Users/me/FromTerminal');
  });

  it('prefers the root VS Code stored itself', async () => {
    await updateSharedConfig({ libraryRoot: '/Users/me/FromTerminal' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    const root = await resolveLibraryRoot(makeContext('/Users/me/FromVscode'));
    expect(root?.fsPath).toBe('/Users/me/FromVscode');
  });
});

// ─── mirrorLibraryRoot ────────────────────────────────────────────────────────

describe('mirrorLibraryRoot', () => {
  afterEach(() => {
    fs.rmSync(sharedConfigPath(), { force: true, recursive: true });
  });

  it('records the root for the terminal app and keeps the keys it wrote', async () => {
    await updateSharedConfig({ terminal: { sort: 'year' } });
    await mirrorLibraryRoot(makeUri('/Users/me/NewLibrary'), makeLogger());
    expect(await readSharedLibraryRoot()).toBe('/Users/me/NewLibrary');
    expect(JSON.parse(fs.readFileSync(sharedConfigPath(), 'utf8')).terminal).toEqual({ sort: 'year' });
  });

  it('logs a failed write with the config path and does not throw', async () => {
    // A directory in place of the file makes the atomic rename fail.
    fs.rmSync(sharedConfigPath(), { force: true, recursive: true });
    fs.mkdirSync(sharedConfigPath(), { recursive: true });
    const logger = makeLogger();
    await expect(mirrorLibraryRoot(makeUri('/Users/me/NewLibrary'), logger)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'storage/libraryLocation',
      expect.anything(),
      expect.objectContaining({ file: sharedConfigPath(), libraryRoot: '/Users/me/NewLibrary' }),
    );
  });
});

// ─── persistLibraryRoot ───────────────────────────────────────────────────────

describe('persistLibraryRoot', () => {
  it('writes the fsPath to globalState', async () => {
    const ctx = makeContext();
    await persistLibraryRoot(ctx, makeUri('/home/user/lib'));
    expect(ctx.globalState.update).toHaveBeenCalledWith('labshelf.libraryRoot', '/home/user/lib');
  });
});

// ─── ensureLibraryStructure ───────────────────────────────────────────────────

describe('ensureLibraryStructure', () => {
  it('creates .research/, .research/logs/, and papers/ directories', async () => {
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const root = makeUri('/tmp/mylib');

    await ensureLibraryStructure(root, fsService);

    const created = (vscode.workspace.fs.createDirectory as jest.Mock).mock.calls.map(
      ([uri]: [vscode.Uri]) => uri.fsPath,
    );
    expect(created.some(p => p.endsWith('.research'))).toBe(true);
    expect(created.some(p => p.endsWith('logs'))).toBe(true);
    expect(created.some(p => p.endsWith('papers'))).toBe(true);
  });
});

// ─── runLibrarySetupWizard ────────────────────────────────────────────────────

describe('runLibrarySetupWizard', () => {
  it('returns undefined when user cancels folder dialog', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    const ctx = makeContext();
    const result = await runLibrarySetupWizard(ctx, createFileSystem);
    expect(result).toBeUndefined();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });

  it('returns undefined when user cancels name input', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    const ctx = makeContext();
    const result = await runLibrarySetupWizard(ctx, createFileSystem);
    expect(result).toBeUndefined();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });

  it('returns the configured Uri and persists it when wizard completes', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('MyLibrary');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const ctx = makeContext();

    const result = await runLibrarySetupWizard(ctx, createFileSystem);

    expect(result).toBeDefined();
    expect(result!.fsPath).toContain('MyLibrary');
    expect(ctx.globalState.update).toHaveBeenCalledWith(
      'labshelf.libraryRoot',
      expect.stringContaining('MyLibrary'),
    );
  });

  it('returns undefined and shows error message when directory creation fails', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('BadLib');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error('EACCES'));
    const ctx = makeContext();

    const result = await runLibrarySetupWizard(ctx, createFileSystem);

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });
});
