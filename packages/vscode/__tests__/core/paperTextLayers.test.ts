import * as vscode from 'vscode';
import { makeGlue, PAPERS_ROOT } from './paperServiceHarness';

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
});

describe('PaperTextLayers.makeSearchable', () => {
  it('replaces paper.pdf through the file-system port and records the OCR verdict', async () => {
    const g = makeGlue();
    await g.seed('scan1986');
    const bytes = new Uint8Array([9, 9]);
    const build = jest.fn(async () => ({ status: 'added', bytes, pagesAdded: 17, pagesFailed: 1 }));

    const result = await g.textLayers({ build }).makeSearchable('scan1986');

    expect(result).toMatchObject({ status: 'added', pagesAdded: 17 });
    expect([...(await g.fs.readFile(`${PAPERS_ROOT}/scan1986/paper.pdf`))]).toEqual([9, 9]);
    expect(await g.fs.readText(`${PAPERS_ROOT}/scan1986/metadata.yaml`)).toMatch(/state: ocr/);
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'ocr', ocrPages: 17, failedPages: 1 });
    expect(g.emitted).toEqual([['paper:updated', expect.objectContaining({ textLayer: expect.objectContaining({ state: 'ocr' }) })]]);
  });

  it('writes to where the paper is now when it moved during OCR', async () => {
    const g = makeGlue();
    await g.seed('scan1986');
    await g.fs.mkdir(`${PAPERS_ROOT}/Moved`);
    const build = jest.fn(async () => {
      await g.service.movePapers(['scan1986'], `${PAPERS_ROOT}/Moved`);
      return { status: 'added', bytes: new Uint8Array([1]), pagesAdded: 2, pagesFailed: 0 };
    });

    await g.textLayers({ build }).makeSearchable('scan1986');

    expect([...(await g.fs.readFile(`${PAPERS_ROOT}/Moved/scan1986/paper.pdf`))]).toEqual([1]);
    expect(g.rows[0]).toMatchObject({ path: `${PAPERS_ROOT}/Moved/scan1986`, textLayer: { state: 'ocr' } });
  });

  it('records the verdict of an outcome that leaves the file alone, and skips an unchanged one', async () => {
    const g = makeGlue();
    await g.seed('p1');
    const build = jest.fn(async () => ({ status: 'not-needed', layer: 'native' }));
    const layers = g.textLayers({ build });

    expect(await layers.makeSearchable('p1')).toEqual({ status: 'not-needed', layer: 'native' });
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'native' });
    await layers.makeSearchable('p1');
    expect(g.indexWrites).toEqual(['upsert:p1']);
  });

  it('skips a paper without a PDF and records nothing', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('EntryNotFound'));
    const g = makeGlue();
    await g.seed('p1');
    const build = jest.fn();

    expect(await g.textLayers({ build }).makeSearchable('p1')).toEqual({ status: 'skipped', reason: 'it has no PDF' });
    expect(build).not.toHaveBeenCalled();
    expect(g.indexWrites).toEqual([]);
  });

  it('records a builder crash as failed and reports a missing builder or paper', async () => {
    const g = makeGlue();
    await g.seed('p1');
    expect(await g.textLayers().makeSearchable('p1')).toMatchObject({ status: 'unavailable' });
    const layers = g.textLayers({ build: jest.fn(async () => { throw new Error('boom'); }) });
    expect(await layers.makeSearchable('ghost')).toEqual({ status: 'unavailable', reason: 'paper not found' });
    expect(await layers.makeSearchable('p1')).toEqual({ status: 'unavailable', reason: 'boom' });
    expect(g.rows[0]!.textLayer).toMatchObject({ state: 'failed', reason: 'boom' });
  });
});

describe('PaperTextLayers.checkTextLayer', () => {
  it('records the detection without reading any page optically', async () => {
    const g = makeGlue();
    await g.seed('p1');
    const builder = { build: jest.fn(), detect: jest.fn(async () => ({ status: 'missing', textlessPages: 3, totalPages: 3 })) };

    expect((await g.textLayers(builder).checkTextLayer('p1'))?.textLayer).toMatchObject({ state: 'missing' });
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('returns undefined for an unknown paper or without a builder', async () => {
    const g = makeGlue();
    await g.seed('p1');
    expect(await g.textLayers().checkTextLayer('p1')).toBeUndefined();
    expect(await g.textLayers({ detect: jest.fn() }).checkTextLayer('ghost')).toBeUndefined();
  });
});
