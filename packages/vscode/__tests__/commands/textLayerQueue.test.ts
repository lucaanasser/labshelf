/**
 * Unit tests for the background queue that makes scanned papers searchable:
 * when its progress appears, what it says, and which outcomes are announced.
 */

import * as vscode from 'vscode';

import type { PaperRecord } from '@labshelf/core';
import {
  currentTextLayerJobs,
  describeOutcome,
  describePage,
  onTextLayerJobsChanged,
  queueTextLayers,
} from '../../src/commands/textLayerQueue';
import type { TextLayerJob } from '../../src/commands/textLayerQueue';
import type { MakeSearchableResult, PaperService } from '../../src/core/paperService';
import type { TextLayerHooks } from '../../src/pdf/searchablePdfBuilder';

const paper = (id: string): PaperRecord => ({ id, title: `Paper ${id}`, path: `/lib/${id}`, citeKey: id, status: 'unread' });

function serviceWith(
  run: (id: string, hooks: TextLayerHooks) => Promise<MakeSearchableResult>,
  check: (id: string) => Promise<PaperRecord | undefined> = async () => undefined,
): PaperService {
  return { makeSearchable: jest.fn(run), checkTextLayer: jest.fn(check) } as unknown as PaperService;
}

describe('queueTextLayers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stays invisible for a paper that already has text', async () => {
    await queueTextLayers(serviceWith(async () => ({ status: 'not-needed' })), [paper('a')]);

    expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('opens a cancellable notification once a page has to be read, then confirms', async () => {
    const report = jest.fn();
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) =>
      task({ report }, { onCancellationRequested: jest.fn() }),
    );
    const service = serviceWith(async (_id, hooks) => {
      hooks.onProgress?.({ index: 1, total: 2, pageNumber: 1 });
      hooks.onProgress?.({ index: 2, total: 2, pageNumber: 2 });
      return { status: 'added', paper: paper('a'), pagesAdded: 2, pagesFailed: 0 };
    });

    await queueTextLayers(service, [paper('a')]);

    expect(vscode.window.withProgress).toHaveBeenCalledTimes(1);
    expect((vscode.window.withProgress as jest.Mock).mock.calls[0][0]).toMatchObject({ cancellable: true });
    expect(report.mock.calls.map(([step]) => step.message)).toEqual([
      'Making "Paper a" searchable — reading page 1 of 2…',
      'Making "Paper a" searchable — reading page 2 of 2…',
    ]);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'LabShelf: "Paper a" is now searchable (2 pages read). Reopen it if it is already open.',
    );
  });

  it('passes cancellation through to the job', async () => {
    let cancel: () => void = () => undefined;
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) =>
      task({ report: jest.fn() }, { onCancellationRequested: (listener: () => void) => { cancel = listener; } }),
    );
    const seen: boolean[] = [];
    const service = serviceWith(async (_id, hooks) => {
      hooks.onProgress?.({ index: 1, total: 2, pageNumber: 1 });
      await Promise.resolve();
      seen.push(hooks.isCancelled?.() ?? false);
      cancel();
      seen.push(hooks.isCancelled?.() ?? false);
      return { status: 'cancelled' };
    });

    await queueTextLayers(service, [paper('a')]);
    expect(seen).toEqual([false, true]);
  });

  it('runs papers one after another and survives a job that throws', async () => {
    const order: string[] = [];
    const service = serviceWith(async (id) => {
      order.push(`start ${id}`);
      await Promise.resolve();
      order.push(`end ${id}`);
      if (id === 'a') { throw new Error('boom'); }
      return { status: 'not-needed' };
    });

    await queueTextLayers(service, [paper('a'), paper('b')]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('describeOutcome / describePage', () => {
  it('only reports quiet outcomes when the user asked for the job', () => {
    expect(describeOutcome('T', { status: 'not-needed' }, false)).toBeUndefined();
    expect(describeOutcome('T', { status: 'not-needed' }, true)).toBe('"T" already has a text layer.');
    expect(describeOutcome('T', { status: 'unavailable', reason: 'no canvas' }, false)).toBeUndefined();
    expect(describeOutcome('T', { status: 'unavailable', reason: 'no canvas' }, true)).toBe(
      'Could not make "T" searchable: no canvas.',
    );
    expect(describeOutcome('T', { status: 'skipped', reason: 'OCR is off' }, false)).toBeUndefined();
    expect(describeOutcome('T', { status: 'skipped', reason: 'OCR is off' }, true)).toBe('"T" was not read: OCR is off.');
  });

  it('mentions pages that could not be read', () => {
    const result: MakeSearchableResult = { status: 'added', paper: paper('a'), pagesAdded: 1, pagesFailed: 2 };
    expect(describeOutcome('T', result, false)).toContain('(1 page read, 2 could not be)');
    expect(describePage('T', { index: 3, total: 17, pageNumber: 5 })).toBe('Making "T" searchable — reading page 3 of 17…');
  });
});

describe('queueTextLayers — modes and the job list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs a silent check without OCR, progress, or a job on the list', async () => {
    const seen: TextLayerJob[][] = [];
    const subscription = onTextLayerJobsChanged((jobs) => seen.push(jobs));
    const service = serviceWith(async () => ({ status: 'not-needed' }));

    await queueTextLayers(service, [paper('a')], { mode: 'check' });
    subscription.dispose();

    expect(service.checkTextLayer).toHaveBeenCalledWith('a');
    expect(service.makeSearchable).not.toHaveBeenCalled();
    expect(seen.every((jobs) => jobs.length === 0)).toBe(true);
    expect(vscode.window.withProgress).not.toHaveBeenCalled();
  });

  it('publishes queued and reading jobs, and clears them when done', async () => {
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_o, task) => task({ report: jest.fn() }, { onCancellationRequested: jest.fn() }));
    const seen: TextLayerJob[][] = [];
    const subscription = onTextLayerJobsChanged((jobs) => seen.push(jobs));
    const service = serviceWith(async (_id, hooks) => {
      hooks.onProgress?.({ index: 1, total: 3, pageNumber: 1 });
      expect(currentTextLayerJobs()).toEqual([
        { paperId: 'a', phase: 'reading', page: 1, total: 3 },
        { paperId: 'b', phase: 'queued' },
      ]);
      return { status: 'not-needed' };
    });

    await queueTextLayers(service, [paper('a'), paper('b')]);
    subscription.dispose();

    expect(seen[0]).toEqual([{ paperId: 'a', phase: 'queued' }, { paperId: 'b', phase: 'queued' }]);
    expect(seen.at(-1)).toEqual([]);
    expect(currentTextLayerJobs()).toEqual([]);
  });

  it('queues a paper once, and upgrades a waiting check when OCR is asked for', async () => {
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const service = serviceWith(
      async (id) => { if (id === 'first') { await blocker; } return { status: 'not-needed' }; },
    );

    const first = queueTextLayers(service, [paper('first')]);
    void queueTextLayers(service, [paper('b')], { mode: 'check' });
    void queueTextLayers(service, [paper('b')], { mode: 'check' });
    void queueTextLayers(service, [paper('b')]);
    expect(currentTextLayerJobs().map((job) => job.paperId)).toEqual(['first', 'b']);

    release();
    await first;
    await queueTextLayers(service, []);

    expect((service.makeSearchable as jest.Mock).mock.calls.map(([id]) => id)).toEqual(['first', 'b']);
    expect(service.checkTextLayer).not.toHaveBeenCalled();
  });

  it('keeps notifying the other listeners when one throws', async () => {
    const good = jest.fn();
    const bad = onTextLayerJobsChanged(() => { throw new Error('view gone'); });
    const fine = onTextLayerJobsChanged(good);

    await queueTextLayers(serviceWith(async () => ({ status: 'not-needed' })), [paper('a')]);
    bad.dispose(); fine.dispose();

    expect(good).toHaveBeenCalled();
  });
});
