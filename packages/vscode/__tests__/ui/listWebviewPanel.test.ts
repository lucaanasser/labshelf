import * as vscode from 'vscode';
import { ListWebviewPanel } from '../../src/ui/list/listWebviewPanel';
import type { ListPanelDeps } from '../../src/ui/list/listWebviewPanel';
import type { LibraryNode, ListPanelState } from '../../src/ui/library/folderNavigation';
import type { TextLayerJob } from '../../src/commands/textLayerQueue';

const ROOT = '/lib/papers';
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function paper(id: string, dir: string) {
  return { id, title: `Title ${id}`, path: `${dir}/${id}`, citeKey: `key-${id}`, authors: [], status: 'unread' };
}

interface Harness {
  deps: ListPanelDeps;
  paperService: Record<string, jest.Mock>;
  bus: { on: jest.Mock; off: jest.Mock };
  onDidNavigate: jest.Mock;
  fire: (msg: Record<string, unknown>) => Promise<void>;
  lastState: () => ListPanelState;
  posted: () => jest.Mock;
}

function open(folder?: LibraryNode, extra: Partial<ListPanelDeps> = {}): Harness {
  const paperService = {
    listPapers: jest.fn(async () => [paper('p1', `${ROOT}/A`), paper('p2', `${ROOT}/A/B`), paper('p3', ROOT)]),
    movePapers: jest.fn(async (ids: string[]) => ({ done: ids, failed: [], moves: [] })),
    updatePaperStatus: jest.fn(async () => undefined),
    trashPapers: jest.fn(async (ids: string[]) => ({ done: ids, failed: [] })),
    removeFromIndex: jest.fn(async () => {}),
    editTags: jest.fn(async (ids: string[]) => ({ done: ids, failed: [] })),
  };
  const bus = { on: jest.fn(), off: jest.fn() };
  const onDidNavigate = jest.fn();
  const deps = {
    extensionUri: vscode.Uri.file('/ext'),
    paperService,
    eventBus: bus,
    getPapersRoot: () => ROOT,
    onDidNavigate,
    ...extra,
  } as unknown as ListPanelDeps;

  ListWebviewPanel.createOrShow(deps, folder);
  const created = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)?.value;
  const posted = (): jest.Mock => created.webview.postMessage as jest.Mock;

  return {
    deps, paperService, bus, onDidNavigate, posted,
    fire: async (msg) => { created.webview._fireMessage(msg); await flush(); await flush(); },
    lastState: () => posted().mock.calls.at(-1)?.[0] as ListPanelState,
  };
}

beforeEach(() => {
  ListWebviewPanel.currentPanel?.dispose();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
  (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
});

describe('ListWebviewPanel', () => {
  it('waits for the webview handshake before pushing state', async () => {
    const h = open();
    await flush();
    expect(h.posted()).not.toHaveBeenCalled();

    await h.fire({ command: 'ready' });
    expect(h.lastState().folder).toEqual({ label: 'All Papers', dirPath: ROOT, isRoot: true });
    expect(h.lastState().papers).toHaveLength(3);
  });

  it('opens a folder that has subfolders and lists them', async () => {
    (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(async (uri: vscode.Uri) =>
      uri.fsPath === `${ROOT}/A` ? [['B', vscode.FileType.Directory]] : [],
    );
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
      if (/(metadata\.yaml|paper\.pdf)$/.test(uri.fsPath)) { throw new Error('missing'); }
      return { type: vscode.FileType.Directory };
    });

    const h = open({ label: 'A', dirPath: `${ROOT}/A` });
    await h.fire({ command: 'ready' });

    expect(h.lastState().subfolders).toEqual([{ label: 'B', dirPath: `${ROOT}/A/B`, count: 1 }]);
    expect(h.lastState().papers.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(h.onDidNavigate).toHaveBeenLastCalledWith({ label: 'A', dirPath: `${ROOT}/A` });
  });

  it('navigates on request and tells the sidebar, reusing the same webview HTML', async () => {
    const h = open();
    await h.fire({ command: 'ready' });
    const created = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)?.value;
    const htmlBefore = created.webview.html;

    await h.fire({ command: 'navigate', dirPath: `${ROOT}/A` });

    expect(h.lastState().folder.dirPath).toBe(`${ROOT}/A`);
    expect(h.onDidNavigate).toHaveBeenLastCalledWith({ label: 'A', dirPath: `${ROOT}/A` });
    expect(created.webview.html).toBe(htmlBefore);
  });

  it('ignores navigation outside papers/', async () => {
    const h = open();
    await h.fire({ command: 'ready' });
    const calls = h.posted().mock.calls.length;

    await h.fire({ command: 'navigate', dirPath: '/etc' });
    expect(h.posted().mock.calls.length).toBe(calls);
  });

  it('falls back to the root when the folder no longer exists', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('gone'));
    const h = open({ label: 'Gone', dirPath: `${ROOT}/Gone` });
    await h.fire({ command: 'ready' });
    expect(h.lastState().folder.isRoot).toBe(true);
  });

  it('adds papers and folders into the folder being viewed', async () => {
    const h = open({ label: 'A', dirPath: `${ROOT}/A` });
    await h.fire({ command: 'ready' });

    await h.fire({ command: 'addPaper' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.addPaperHere', { label: 'A', dirPath: `${ROOT}/A` });

    await h.fire({ command: 'newFolder' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.newFolder', { label: 'A', dirPath: `${ROOT}/A` });
  });

  it('moves papers into a target inside papers/ and rejects targets outside it', async () => {
    const h = open();
    await h.fire({ command: 'ready' });

    await h.fire({ command: 'movePapers', paperIds: ['p1', 7], targetDir: `${ROOT}/A/B` });
    expect(h.paperService['movePapers']).toHaveBeenCalledWith(['p1'], `${ROOT}/A/B`);

    await h.fire({ command: 'movePapers', paperIds: ['p1'], targetDir: '/tmp' });
    expect(h.paperService['movePapers']).toHaveBeenCalledTimes(1);
  });

  it('reports move failures', async () => {
    const h = open();
    await h.fire({ command: 'ready' });
    h.paperService['movePapers']!.mockResolvedValue({ done: [], failed: [{ id: 'p1', error: 'exists' }], moves: [] });

    await h.fire({ command: 'movePapers', paperIds: ['p1'], targetDir: `${ROOT}/A` });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('exists'));
  });

  it('offers every folder in the move picker', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockImplementation(async (items: Array<{ dirPath: string }>) => items[0]);
    const h = open({ label: 'A', dirPath: `${ROOT}/A` });
    await h.fire({ command: 'ready' });

    await h.fire({ command: 'pickMoveTarget', paperIds: ['p1'] });
    expect(h.paperService['movePapers']).toHaveBeenCalledWith(['p1'], ROOT);
  });

  it('follows its folder when an ancestor is renamed or moved', async () => {
    const h = open({ label: 'B', dirPath: `${ROOT}/A/B` });
    await h.fire({ command: 'ready' });

    await ListWebviewPanel.currentPanel?.followFolderMove(`${ROOT}/A`, `${ROOT}/Renamed`);
    expect(h.lastState().folder.dirPath).toBe(`${ROOT}/Renamed/B`);
  });

  it('keeps routing paper actions to the service and commands', async () => {
    const h = open();
    await h.fire({ command: 'ready' });

    await h.fire({ command: 'openPdf', paperId: 'p1' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.openPdfViewer', 'p1');

    await h.fire({ command: 'updateStatus', paperId: 'p1', status: 'done' });
    expect(h.paperService['updatePaperStatus']).toHaveBeenCalledWith('p1', 'done');
  });

  it('carries hasPdf to the webview and still routes openPdf for a PDF-less paper', async () => {
    const paperService = {
      listPapers: jest.fn(async () => [
        { ...paper('p1', ROOT), hasPdf: true },
        { ...paper('p2', ROOT), hasPdf: false },
      ]),
      movePapers: jest.fn(), updatePaperStatus: jest.fn(), trashPapers: jest.fn(),
    };
    const h = open(undefined, { paperService } as unknown as Partial<ListPanelDeps>);
    await h.fire({ command: 'ready' });

    const byId = new Map(h.lastState().papers.map((p) => [p.id, p]));
    expect(byId.get('p1')!.hasPdf).toBe(true);
    expect(byId.get('p2')!.hasPdf).toBe(false);

    // The panel still forwards the request; the host guard (ensurePaperPdf) decides.
    await h.fire({ command: 'openPdf', paperId: 'p2' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.openPdfViewer', 'p2');
  });

  it('routes tag edits to the service in one batch', async () => {
    const h = open();
    await h.fire({ command: 'ready' });
    await h.fire({ command: 'setTags', paperIds: ['p1', 'p2'], add: ['nlp'], remove: ['old'] });
    expect(h.paperService['editTags']).toHaveBeenCalledWith(['p1', 'p2'], ['nlp'], ['old']);
  });

  it('shows a failed trash and keeps the paper', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Remove + delete files');
    const h = open();
    await h.fire({ command: 'ready' });
    h.paperService['trashPapers']!.mockResolvedValue({ done: [], failed: [{ id: 'p1', error: 'EPERM' }] });

    await h.fire({ command: 'deletePaper', paperId: 'p1' });

    expect(h.paperService['trashPapers']).toHaveBeenCalledWith(['p1']);
    expect(h.paperService['removeFromIndex']).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('LabShelf: Could not move "Title p1" to the trash — EPERM');
  });

  it('removes from the list only when asked to keep the files', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce('Remove only');
    const h = open();
    await h.fire({ command: 'ready' });
    await h.fire({ command: 'deletePaper', paperId: 'p1' });
    expect(h.paperService['removeFromIndex']).toHaveBeenCalledWith('p1');
    expect(h.paperService['trashPapers']).not.toHaveBeenCalled();
  });

  it('detaches its event listeners on dispose', async () => {
    const h = open();
    ListWebviewPanel.currentPanel?.dispose();
    expect(h.bus.off).toHaveBeenCalledTimes(h.bus.on.mock.calls.length);
    expect(ListWebviewPanel.currentPanel).toBeUndefined();
  });
});

describe('ListWebviewPanel — text layers', () => {
  function withJobs(initial: TextLayerJob[] = []) {
    let listener: (jobs: TextLayerJob[]) => void = () => undefined;
    const subscription = { dispose: jest.fn() };
    const textLayerJobs = {
      current: jest.fn(() => initial),
      onDidChange: jest.fn((l: (jobs: TextLayerJob[]) => void) => { listener = l; return subscription; }),
    };
    return { textLayerJobs, subscription, emit: (jobs: TextLayerJob[]) => listener(jobs) };
  }

  it('sends the running jobs after every state, and each update as it comes', async () => {
    const jobs = withJobs([{ paperId: 'p1', phase: 'reading', page: 2, total: 9 }]);
    const h = open(undefined, { textLayerJobs: jobs.textLayerJobs } as Partial<ListPanelDeps>);

    jobs.emit([{ paperId: 'p1', phase: 'queued' }]);
    expect(h.posted()).not.toHaveBeenCalled();

    await h.fire({ command: 'ready' });
    const messages = h.posted().mock.calls.map(([message]) => message.type);
    expect(messages).toEqual(['state', 'jobs']);
    expect(h.posted().mock.calls[1][0]).toEqual({ type: 'jobs', jobs: [{ paperId: 'p1', phase: 'reading', page: 2, total: 9 }] });

    jobs.emit([]);
    await flush();
    expect(h.posted().mock.calls.at(-1)?.[0]).toEqual({ type: 'jobs', jobs: [] });
  });

  it('asks for OCR on one paper or a selection', async () => {
    const h = open();
    await h.fire({ command: 'ready' });

    await h.fire({ command: 'makeSearchable', paperId: 'p1' });
    await h.fire({ command: 'makeSearchable', paperIds: ['p2', 'p3', 7] });
    await h.fire({ command: 'makeSearchable', paperIds: [] });

    const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(([name]) => name === 'labshelf.makeSearchable');
    expect(calls).toEqual([['labshelf.makeSearchable', ['p1']], ['labshelf.makeSearchable', ['p2', 'p3']]]);
  });

  it('stops listening to job updates when closed', async () => {
    const jobs = withJobs();
    open(undefined, { textLayerJobs: jobs.textLayerJobs } as Partial<ListPanelDeps>);

    ListWebviewPanel.currentPanel?.dispose();
    expect(jobs.subscription.dispose).toHaveBeenCalled();
  });
});
