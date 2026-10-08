import * as vscode from 'vscode';
import { makeGlue, PAPERS_ROOT } from './paperServiceHarness';

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
});

describe('PaperService field edits', () => {
  it('writes metadata.yaml first, then updates the index and announces the paper', async () => {
    const g = makeGlue();
    await g.seed('p1');

    const updated = await g.service.updatePaperFields('p1', { status: 'done', note: 'read twice' });

    expect(updated).toMatchObject({ status: 'done', note: 'read twice' });
    expect(await g.fs.readText(`${PAPERS_ROOT}/p1/metadata.yaml`)).toMatch(/status: done/);
    expect(g.rows[0]).toMatchObject({ status: 'done', note: 'read twice' });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ id: 'p1', status: 'done' })]]);
  });

  it('leaves the index and events alone when the disk write fails', async () => {
    const g = makeGlue();
    await g.seed('p1');
    g.fs.failWrites = new Error('EACCES');

    await expect(g.service.updatePaperFields('p1', { status: 'done' })).rejects.toThrow('EACCES');

    expect(g.indexWrites).toEqual([]);
    expect(g.rows[0]!.status).toBe('unread');
    expect(g.emitted).toEqual([]);
  });

  it('does not re-announce a patch that changes nothing', async () => {
    const g = makeGlue();
    await g.seed('p1');
    await g.service.updatePaperStatus('p1', 'unread');
    expect(g.emitted).toEqual([]);
  });

  it('edits tags on several papers and reports unknown ids', async () => {
    const g = makeGlue();
    await g.seed('p1', { tags: ['old', 'keep'] });
    await g.seed('p2');

    const outcome = await g.service.editTags(['p1', 'p2', 'ghost'], ['new'], ['old']);

    expect(outcome.done).toEqual(['p1', 'p2']);
    expect(outcome.failed).toEqual([{ id: 'ghost', error: 'Paper not found' }]);
    expect(g.rows.map((row) => row.tags)).toEqual([['keep', 'new'], ['new']]);
  });
});

describe('PaperService.trashPapers', () => {
  it('drops the row and announces it only once the folder is in the trash', async () => {
    const g = makeGlue();
    await g.seed('p1');

    expect(await g.service.trashPapers(['p1'])).toEqual({ done: ['p1'], failed: [] });
    expect(await g.fs.exists(`${PAPERS_ROOT}/p1`)).toBe(false);
    expect(g.rows).toEqual([]);
    expect(g.emitted).toEqual([['paper:deleted', { id: 'p1' }]]);
  });

  it('keeps a paper whose trash fails in the index and reports why', async () => {
    const g = makeGlue();
    await g.seed('p1');
    g.fs.trashFails.add(`${PAPERS_ROOT}/p1`);

    const outcome = await g.service.trashPapers(['p1']);

    expect(outcome.done).toEqual([]);
    expect(outcome.failed).toEqual([{ id: 'p1', error: `Cannot move ${PAPERS_ROOT}/p1 to the trash` }]);
    expect(g.rows.map((row) => row.id)).toEqual(['p1']);
    expect(g.emitted).toEqual([]);
  });
});

describe('PaperService.movePapers', () => {
  it('moves the folder on disk, then re-points the record', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/A`);
    await g.fs.mkdir(`${PAPERS_ROOT}/B`);

    const outcome = await g.service.movePapers(['p1', 'ghost'], `${PAPERS_ROOT}/B`);

    expect(outcome.done).toEqual(['p1']);
    expect(outcome.failed).toEqual([{ id: 'ghost', error: 'Paper not found' }]);
    expect(await g.fs.exists(`${PAPERS_ROOT}/B/p1/metadata.yaml`)).toBe(true);
    expect(g.rows[0]!.path).toBe(`${PAPERS_ROOT}/B/p1`);
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ path: `${PAPERS_ROOT}/B/p1` })]]);
  });

  it('reports a name clash in the shared wording and leaves the record where it is', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/A`);
    await g.fs.mkdir(`${PAPERS_ROOT}/B/p1`);

    const outcome = await g.service.movePapers(['p1'], `${PAPERS_ROOT}/B`);

    expect(outcome.failed).toEqual([{ id: 'p1', error: '"p1" already exists there' }]);
    expect(g.rows[0]!.path).toBe(`${PAPERS_ROOT}/A/p1`);
  });
});

describe('PaperService metadata rewrites', () => {
  it('applies resolved metadata, keeping the status the file holds', async () => {
    const g = makeGlue();
    await g.seed('p1');
    await g.fs.writeText(`${PAPERS_ROOT}/p1/metadata.yaml`, 'title: "Title p1"\nstatus: reading\n');

    const updated = await g.service.applyResolvedMetadata('p1', { title: 'Resolved', doi: '10.1/x' });

    expect(updated).toMatchObject({ title: 'Resolved', doi: '10.1/x', status: 'reading' });
    expect(g.rows[0]).toMatchObject({ title: 'Resolved', status: 'reading' });
  });
});

describe('PaperService PDF lookups', () => {
  it('resolves the PDF from the stored path, and null for an unknown id or a paper without one', async () => {
    const g = makeGlue();
    await g.seed('p1', {}, `${PAPERS_ROOT}/Project`);
    await g.seed('p2', { hasPdf: false });
    expect((await g.service.resolvePdfUri('p1'))?.fsPath).toBe(`${PAPERS_ROOT}/Project/p1/paper.pdf`);
    expect(await g.service.resolvePdfUri('p2')).toBeNull();
    expect(await g.service.resolvePdfUri('ghost')).toBeNull();
  });

  it('reconcilePdf corrects a stale flag in the index only', async () => {
    const g = makeGlue();
    await g.seed('p1', { hasPdf: false });
    expect(await g.service.reconcilePdf('p1')).toEqual({ paper: expect.objectContaining({ hasPdf: true }), hasPdf: true });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ hasPdf: true })]]);
  });
});
