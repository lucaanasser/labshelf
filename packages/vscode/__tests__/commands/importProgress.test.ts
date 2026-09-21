/**
 * Unit tests for import feedback: the progress shown while a paper is being
 * read and identified, and the confirmation naming what was added.
 */

import * as vscode from 'vscode';

import type { BatchImportResult, PaperRecord } from '@labshelf/core';
import { announceImport, describeResult, describeStep, importWithProgress } from '../../src/commands/importProgress';
import type { ImportProgress, PaperService } from '../../src/core/paperService';

const paper = (title: string): PaperRecord => ({ id: title, title, path: `/lib/${title}`, citeKey: title, status: 'unread' });
const result = (overrides: Partial<BatchImportResult>): BatchImportResult => ({
  success: [],
  failed: [],
  skipped: [],
  needsReview: [],
  ...overrides,
});

describe('importWithProgress', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows progress in the library view and in a notification while importing', async () => {
    const imported = result({ success: [paper('A')] });
    const service = { addPapersFromUris: jest.fn(async () => imported) } as unknown as PaperService;
    const uris = [vscode.Uri.file('/docs/a.pdf')];

    expect(await importWithProgress(service, uris)).toBe(imported);

    const locations = (vscode.window.withProgress as jest.Mock).mock.calls.map(([options]) => options.location);
    expect(locations).toEqual([{ viewId: 'labshelf.library' }, vscode.ProgressLocation.Notification]);
    expect(service.addPapersFromUris).toHaveBeenCalledWith(uris, undefined, expect.any(Function));
  });

  it('names the file in progress and advances the bar only after the first file', async () => {
    const report = jest.fn();
    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) => task({ report }, {}));
    const service = {
      addPapersFromUris: jest.fn(async (_uris, _target, onProgress: (step: ImportProgress) => void) => {
        onProgress({ index: 1, total: 2, fileName: 'a.pdf' });
        onProgress({ index: 2, total: 2, fileName: 'b.pdf' });
        return result({});
      }),
    } as unknown as PaperService;

    await importWithProgress(service, []);

    const steps = report.mock.calls.map(([step]) => step).filter((step) => /Importing/.test(step.message));
    expect(steps[0].message).toContain('1 of 2: "a.pdf"');
    // An increment on the first file would freeze a single import at 0%.
    expect(steps[0]).not.toHaveProperty('increment');
    expect(steps[1]).toMatchObject({ increment: 50 });
  });
});

describe('describeStep', () => {
  it('omits the counter for a single file', () => {
    expect(describeStep({ index: 1, total: 1, fileName: 'artigo-1.pdf' })).toBe(
      'Importing: "artigo-1.pdf" — reading and identifying the paper…',
    );
  });
});

describe('describeResult / announceImport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('confirms a single import with the extracted title', () => {
    expect(describeResult(result({ success: [paper('Attention Is All You Need')] }))).toBe(
      'Added "Attention Is All You Need"',
    );
  });

  it('counts a batch and flags the papers that need review', () => {
    const papers = [paper('A'), paper('B'), paper('C')];
    expect(describeResult(result({ success: papers, needsReview: [papers[2]!] }))).toBe(
      '3 papers imported (1 could not be identified and needs review)',
    );
  });

  it('stays silent when nothing was imported', () => {
    announceImport(result({}));
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

    announceImport(result({ success: [paper('A')] }));
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('LabShelf: Added "A"');
  });
});
