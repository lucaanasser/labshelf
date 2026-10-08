/** Import feedback: the progress shown while a paper is read and identified, and the one summary of what happened. */
import * as vscode from 'vscode';

import type { ImportOutcome, ImportProgress, PaperRecord } from '@labshelf/core';
import { announceImport, describeStep, importPapers, importWithProgress } from '../../src/commands/importProgress';
import type { ImportServices } from '../../src/commands/importProgress';
import { queueTextLayers } from '../../src/commands/textLayerQueue';

const paper = (title: string): PaperRecord => ({ id: title, title, path: `/lib/${title}`, citeKey: title, status: 'unread' });
const added = (title: string, needsReview = false): ImportOutcome => ({ status: 'added', record: paper(title), needsReview, input: `/docs/${title}.pdf` });

function services(outcomes: ImportOutcome[], run?: (onProgress: (step: ImportProgress) => void) => void): ImportServices & {
  importer: { importPaths: jest.Mock };
  textLayers: { makeSearchable: jest.Mock; checkTextLayer: jest.Mock };
} {
  return {
    importer: { importPaths: jest.fn(async (_inputs, _target, onProgress) => { run?.(onProgress); return outcomes; }) },
    textLayers: { makeSearchable: jest.fn(async () => ({ status: 'not-needed' })), checkTextLayer: jest.fn(async () => undefined) },
    paperService: {},
    logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) },
  } as never;
}

beforeEach(() => jest.clearAllMocks());

describe('importWithProgress', () => {
  it('shows progress in the library view and in a notification while importing', async () => {
    const s = services([added('A')]);
    const uris = [vscode.Uri.file('/docs/a.pdf')];

    expect(await importWithProgress(s, uris, '/lib/papers/ML')).toEqual([added('A')]);

    const locations = (vscode.window.withProgress as jest.Mock).mock.calls.map(([options]) => options.location);
    expect(locations).toEqual([{ viewId: 'labshelf.library' }, vscode.ProgressLocation.Notification]);
    expect(s.importer.importPaths).toHaveBeenCalledWith(['/docs/a.pdf'], '/lib/papers/ML', expect.any(Function));
  });

  it('names the file in progress and advances the bar only after the first file', async () => {
    const report = jest.fn();
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) => task({ report }, {}));
    const s = services([], (onProgress) => {
      onProgress({ index: 1, total: 2, input: '/docs/a.pdf' });
      onProgress({ index: 2, total: 2, input: '/docs/b.pdf' });
    });

    await importWithProgress(s, []);

    const steps = report.mock.calls.map(([step]) => step).filter((step) => /Importing/.test(step.message));
    expect(steps[0].message).toContain('1 of 2: "a.pdf"');
    // An increment on the first file would freeze a single import at 0%.
    expect(steps[0]).not.toHaveProperty('increment');
    expect(steps[1]).toMatchObject({ increment: 50 });
  });
});

describe('describeStep', () => {
  it('omits the counter for a single file', () => {
    expect(describeStep({ index: 1, total: 1, input: '/docs/artigo-1.pdf' })).toBe(
      'Importing: "artigo-1.pdf" — reading and identifying the paper…',
    );
  });
});

describe('announceImport', () => {
  it('confirms a single import with the extracted title', () => {
    announceImport([added('Attention Is All You Need')]);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('LabShelf: Added "Attention Is All You Need"');
  });

  it('warns with the shared counts and the first error when something failed', () => {
    announceImport([added('A'), { status: 'duplicate', existingId: 'x', input: '/d/x.pdf' }, { status: 'failed', error: 'Not a PDF file', input: '/d/r.pdf' }]);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('LabShelf: 1 added, 1 already in the library, 1 failed: Not a PDF file');
  });
});

describe('importPapers', () => {
  it('offers a metadata lookup for the papers no registry confirmed', async () => {
    const s = services([added('Sure'), added('Unsure', true)]);
    await importPapers(s, [vscode.Uri.file('/docs')]);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('could not identify "Unsure"'), 'Look up', 'Enter manually', 'Later',
    );
  });
});

describe('importWithProgress — text layers after import', () => {
  const config = (vscode.workspace as unknown as { _config: Record<string, Record<string, unknown>> })._config;
  afterEach(() => { delete config['labshelf']; });

  async function importOne() {
    const s = services([added('Scan'), { status: 'failed', error: 'x', input: '/d/y.pdf' }]);
    await importWithProgress(s, [vscode.Uri.file('/docs/scan.pdf')]);
    // Queueing nothing returns the queue's tail: everything queued so far is done.
    await queueTextLayers(s.textLayers as never, []);
    return s.textLayers;
  }

  it('makes each imported paper searchable by default', async () => {
    const layers = await importOne();
    expect(layers.makeSearchable).toHaveBeenCalledTimes(1);
    expect(layers.makeSearchable).toHaveBeenCalledWith('Scan', expect.any(Object));
    expect(layers.checkTextLayer).not.toHaveBeenCalled();
  });

  it('only checks it when automatic OCR is turned off', async () => {
    config['labshelf'] = { 'ocr.makeSearchable': false };
    const layers = await importOne();
    expect(layers.checkTextLayer).toHaveBeenCalledWith('Scan');
    expect(layers.makeSearchable).not.toHaveBeenCalled();
  });
});
