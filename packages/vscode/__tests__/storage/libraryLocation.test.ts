import * as vscode from 'vscode';
import {
  resolveLibraryRoot,
  persistLibraryRoot,
  ensureLibraryStructure,
  runLibrarySetupWizard,
} from '../../src/storage/libraryLocation';
import { FileSystemService } from '../../src/storage/fileSystemService';

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

const fsService = new FileSystemService();

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
    const result = await runLibrarySetupWizard(ctx, fsService);
    expect(result).toBeUndefined();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });

  it('returns undefined when user cancels name input', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    const ctx = makeContext();
    const result = await runLibrarySetupWizard(ctx, fsService);
    expect(result).toBeUndefined();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });

  it('returns the configured Uri and persists it when wizard completes', async () => {
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([makeUri('/tmp')]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('MyLibrary');
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const ctx = makeContext();

    const result = await runLibrarySetupWizard(ctx, fsService);

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

    const result = await runLibrarySetupWizard(ctx, fsService);

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(ctx.globalState.update).not.toHaveBeenCalled();
  });
});
