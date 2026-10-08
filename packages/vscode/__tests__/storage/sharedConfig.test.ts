import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { readSharedLibraryRoot, sharedConfigPath, writeSharedLibraryRoot } from '../../src/storage/paths/sharedConfig';
import { persistLibraryRoot, resolveLibraryRoot } from '../../src/storage/paths/libraryLocation';

function tempConfig(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-shared-')), 'labshelf', 'config.json');
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

describe('shared LabShelf config', () => {
  it('lives under XDG_CONFIG_HOME', () => {
    expect(sharedConfigPath({ XDG_CONFIG_HOME: '/x' })).toBe(path.join('/x', 'labshelf', 'config.json'));
  });

  it('reads nothing from a missing, broken or relative entry', async () => {
    const file = tempConfig();
    expect(await readSharedLibraryRoot(file)).toBeUndefined();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ nope');
    expect(await readSharedLibraryRoot(file)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ libraryRoot: 'relative/lib' }));
    expect(await readSharedLibraryRoot(file)).toBeUndefined();
  });

  it('writes the root and keeps the keys the terminal app wrote', async () => {
    const file = tempConfig();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, terminal: { sort: 'year' } }));
    await writeSharedLibraryRoot('/Users/me/LabShelfLibrary', file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved).toEqual({ version: 1, terminal: { sort: 'year' }, libraryRoot: '/Users/me/LabShelfLibrary' });
    expect(await readSharedLibraryRoot(file)).toBe('/Users/me/LabShelfLibrary');
  });

  it('does not rewrite the file when the root is already recorded', async () => {
    const file = tempConfig();
    await writeSharedLibraryRoot('/lib', file);
    const before = fs.statSync(file).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeSharedLibraryRoot('/lib', file);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});

describe('library location and the shared config', () => {
  it('adopts a library set up in the terminal app when VS Code has none', async () => {
    await writeSharedLibraryRoot('/Users/me/FromTerminal', sharedConfigPath());
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    const root = await resolveLibraryRoot(makeContext());
    expect(root?.fsPath).toBe('/Users/me/FromTerminal');
  });

  it('prefers the root VS Code stored itself', async () => {
    await writeSharedLibraryRoot('/Users/me/FromTerminal', sharedConfigPath());
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    const root = await resolveLibraryRoot(makeContext('/Users/me/FromVscode'));
    expect(root?.fsPath).toBe('/Users/me/FromVscode');
  });

  it('records a newly configured root for the terminal app', async () => {
    await persistLibraryRoot(makeContext(), vscode.Uri.file('/Users/me/NewLibrary'));
    expect(await readSharedLibraryRoot(sharedConfigPath())).toBe('/Users/me/NewLibrary');
  });
});
