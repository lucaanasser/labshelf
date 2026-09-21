/**
 * Unit tests for the background queue that makes scanned papers searchable:
 * when its progress appears, what it says, and which outcomes are announced.
 */

import * as vscode from 'vscode';

import type { PaperRecord } from '@labshelf/core';
import { describeOutcome, describePage, queueTextLayers } from '../../src/commands/textLayerQueue';
import type { MakeSearchableResult, PaperService } from '../../src/core/paperService';
import type { TextLayerHooks } from '../../src/pdf/searchablePdfBuilder';

const paper = (id: string): PaperRecord => ({ id, title: `Paper ${id}`, path: `/lib/${id}`, citeKey: id, status: 'unread' });

function serviceWith(run: (id: string, hooks: TextLayerHooks) => Promise<MakeSearchableResult>): PaperService {
  return { makeSearchable: jest.fn(run) } as unknown as PaperService;
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
  });

  it('mentions pages that could not be read', () => {
    const result: MakeSearchableResult = { status: 'added', paper: paper('a'), pagesAdded: 1, pagesFailed: 2 };
    expect(describeOutcome('T', result, false)).toContain('(1 page read, 2 could not be)');
    expect(describePage('T', { index: 3, total: 17, pageNumber: 5 })).toBe('Making "T" searchable — reading page 3 of 17…');
  });
});
