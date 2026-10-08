import * as vscode from 'vscode';

import { moveFolders, registerFolderCommands, type FolderCommandHost } from '../../src/commands/folderCommands';
import { makeGlue, PAPERS_ROOT, type Glue } from '../core/paperServiceHarness';

function host(g: Glue): FolderCommandHost & { refreshViews: jest.Mock; followFolderMove: jest.Mock } {
  const services = { mutations: g.ctx, paperService: g.service, logger: { log: jest.fn(async () => {}), error: jest.fn() } };
  return {
    requireServices: jest.fn(async () => services as never),
    papersRoot: () => PAPERS_ROOT,
    refreshViews: jest.fn(),
    followFolderMove: jest.fn(async () => {}),
  };
}

function command(id: string): (...args: unknown[]) => Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id);
  return call![1];
}

const node = (dirPath: string) => ({ label: dirPath.split('/').pop()!, dirPath, isRoot: false });

beforeEach(() => jest.clearAllMocks());

describe('folder commands', () => {
  it('keeps the papers of a folder whose trash fails, and shows why', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/ML`);
    g.fs.trashFails.add(`${PAPERS_ROOT}/ML`);
    registerFolderCommands({ subscriptions: [] } as never, host(g));
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Delete');

    await command('labshelf.deleteFolder')(node(`${PAPERS_ROOT}/ML`));

    expect(g.rows.map((row) => row.id)).toEqual(['p1']);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Could not delete "ML"'));
  });

  it('drops the papers of a trashed folder after the trash', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/ML`);
    registerFolderCommands({ subscriptions: [] } as never, host(g));
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Delete');

    await command('labshelf.deleteFolder')(node(`${PAPERS_ROOT}/ML`));

    expect(await g.fs.exists(`${PAPERS_ROOT}/ML`)).toBe(false);
    expect(g.emitted).toEqual([['paper:deleted', { id: 'p1' }]]);
  });

  it('renames a folder and re-points its papers', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/ml`);
    const h = host(g);
    registerFolderCommands({ subscriptions: [] } as never, h);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('Learning');

    await command('labshelf.renameFolder')(node(`${PAPERS_ROOT}/ml`));

    expect(g.rows[0]!.path).toBe(`${PAPERS_ROOT}/Learning/p1`);
    expect(h.followFolderMove).toHaveBeenCalledWith(`${PAPERS_ROOT}/ml`, `${PAPERS_ROOT}/Learning`);
  });

  it('does nothing when a folder is dropped on the folder it is already in', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/ML`);
    const h = host(g);

    await moveFolders(h, [`${PAPERS_ROOT}/ML`], PAPERS_ROOT);

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(h.followFolderMove).not.toHaveBeenCalled();
    expect(g.indexWrites).toEqual([]);
  });

  it('shows the shared clash wording when a folder of that name is already there', async () => {
    const g = makeGlue();
    await g.fs.mkdir(`${PAPERS_ROOT}/A/ML`);
    await g.fs.mkdir(`${PAPERS_ROOT}/ML`);

    await moveFolders(host(g), [`${PAPERS_ROOT}/ML`], `${PAPERS_ROOT}/A`);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('LabShelf: Could not move "ML" — "ML" already exists there');
  });
});
