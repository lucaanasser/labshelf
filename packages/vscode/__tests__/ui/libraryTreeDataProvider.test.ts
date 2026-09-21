import * as vscode from 'vscode';
import { LibraryDragAndDropController, LibraryTreeDataProvider } from '../../src/ui/library/libraryTreeDataProvider';

const ROOT = '/lib/papers';
const TREE_MIME = 'application/vnd.code.tree.labshelf.library';

// Disk layout: papers/{A/{B}, Z, loose-paper}; loose-paper is a paper folder, not a collection.
function mockDisk(): void {
  const dirs: Record<string, string[]> = { [ROOT]: ['Z', 'A', 'loose-paper', '.hidden'], [`${ROOT}/A`]: ['B'] };
  (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) =>
    (dirs[uri.fsPath] ?? []).map((name) => [name, vscode.FileType.Directory]),
  );
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    if (uri.fsPath === `${ROOT}/loose-paper/paper.pdf`) { return { type: vscode.FileType.File }; }
    throw new Error('missing');
  });
}

function makeProvider(): { provider: LibraryTreeDataProvider; bus: { on: jest.Mock } } {
  const bus = { on: jest.fn() };
  const provider = new LibraryTreeDataProvider(vscode.Uri.file(ROOT), bus as never);
  provider.setPaperPathSource(async () => [`${ROOT}/A/p1`, `${ROOT}/A/B/p2`, `${ROOT}/loose-paper`]);
  return { provider, bus };
}

beforeEach(mockDisk);

describe('LibraryTreeDataProvider', () => {
  it('lists "All Papers" first, then sorted collection folders, skipping paper and hidden folders', async () => {
    const { provider } = makeProvider();
    const top = await provider.getChildren();
    expect(top.map((n) => n.label)).toEqual(['All Papers', 'A', 'Z']);
    expect(top[0]).toMatchObject({ dirPath: ROOT, isRoot: true });
    expect(await provider.getChildren(top[0])).toEqual([]);
  });

  it('returns nothing while no library is configured', async () => {
    const provider = new LibraryTreeDataProvider(null, { on: jest.fn() } as never);
    expect(await provider.getChildren()).toEqual([]);
  });

  it('opens every folder in the list panel, including ones with subfolders', async () => {
    const { provider } = makeProvider();
    const parent = { label: 'A', dirPath: `${ROOT}/A` };
    const item = await provider.getTreeItem(parent);

    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.command).toEqual({ command: 'labshelf.openListTab', title: 'Open', arguments: [parent] });
    expect(item.contextValue).toBe('labshelfFolder');
  });

  it('shows recursive paper counts and omits them for empty folders', async () => {
    const { provider } = makeProvider();
    expect((await provider.getTreeItem({ label: 'A', dirPath: `${ROOT}/A` })).description).toBe('2');
    expect((await provider.getTreeItem({ label: 'Z', dirPath: `${ROOT}/Z` })).description).toBeUndefined();

    const root = await provider.getTreeItem(provider.rootNode()!);
    expect(root.description).toBe('3');
    expect(root.contextValue).toBe('labshelfRoot');
    expect(root.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('still renders when the count source fails', async () => {
    const { provider } = makeProvider();
    provider.setPaperPathSource(async () => { throw new Error('db down'); });
    expect((await provider.getTreeItem({ label: 'A', dirPath: `${ROOT}/A` })).label).toBe('A');
  });

  it('resolves parents for reveal and stops at the top level', () => {
    const { provider } = makeProvider();
    expect(provider.getParent({ label: 'B', dirPath: `${ROOT}/A/B` })).toEqual({ label: 'A', dirPath: `${ROOT}/A` });
    expect(provider.getParent({ label: 'A', dirPath: `${ROOT}/A` })).toBeNull();
    expect(provider.getParent(provider.rootNode()!)).toBeNull();
  });

  it('coalesces a burst of paper events into one refresh', () => {
    jest.useFakeTimers();
    try {
      const { provider, bus } = makeProvider();
      const fired = jest.fn();
      provider.onDidChangeTreeData(fired);
      const onUpdated = bus.on.mock.calls.find(([event]) => event === 'paper:updated')?.[1] as () => void;

      onUpdated(); onUpdated(); onUpdated();
      jest.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LibraryDragAndDropController', () => {
  it('moves folders dragged inside the tree into the drop target', async () => {
    const onFileDrop = jest.fn(async () => {});
    const onFolderMove = jest.fn(async () => {});
    const dnd = new LibraryDragAndDropController(onFileDrop, onFolderMove);
    const transfer = new (vscode as any).DataTransfer({ [TREE_MIME]: [`${ROOT}/Z`] });

    await dnd.handleDrop({ label: 'A', dirPath: `${ROOT}/A` }, transfer);
    expect(onFolderMove).toHaveBeenCalledWith([`${ROOT}/Z`], `${ROOT}/A`);
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it('never drags the "All Papers" entry', () => {
    const dnd = new LibraryDragAndDropController(jest.fn(), jest.fn());
    const transfer = { set: jest.fn() };
    dnd.handleDrag([{ label: 'All Papers', dirPath: ROOT, isRoot: true }], transfer as never);
    expect(transfer.set).not.toHaveBeenCalled();
  });

  it('imports OS file drops, ignoring comments and non-file URIs', async () => {
    const onFileDrop = jest.fn(async () => {});
    const dnd = new LibraryDragAndDropController(onFileDrop, jest.fn());
    const transfer = new (vscode as any).DataTransfer({
      'text/uri-list': '# comment\nfile:///tmp/a.pdf\nhttps://example.com/b.pdf\n',
    });

    await dnd.handleDrop(undefined, transfer);
    expect(onFileDrop).toHaveBeenCalledTimes(1);
    const [uris, target] = onFileDrop.mock.calls[0] as unknown as [vscode.Uri[], string | undefined];
    expect(uris.map((u) => u.fsPath)).toEqual(['/tmp/a.pdf']);
    expect(target).toBeUndefined();
  });
});
