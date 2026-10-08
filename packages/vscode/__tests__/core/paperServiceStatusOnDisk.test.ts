import * as vscode from 'vscode';
import type { IFileSystem, LibraryLayout, BibTeXService, EventBus, IResearchDatabase, PaperRecord, PdfImportParser } from '@labshelf/core';

import { PaperService } from '../../src/core/paperService';

// The terminal app (or a sync) can change a paper's status on disk before VS Code re-indexes it. A rewrite VS Code
// makes for another reason must not put its stale status back.

const indexed: PaperRecord = {
  id: 'vaswani2017', title: 'Attention', path: '/lib/papers/vaswani2017', citeKey: 'vaswani2017', status: 'unread', hasPdf: true,
};

function makeService(onDisk: string | Error) {
  const rows: PaperRecord[] = [{ ...indexed }];
  const written: PaperRecord[] = [];
  const db: Partial<IResearchDatabase> = {
    listPapers: jest.fn(async () => rows.map((row) => ({ ...row }))),
    upsertPaper: jest.fn(async (paper: PaperRecord) => { rows[0] = paper; }),
  };
  const fsService: Partial<IFileSystem> = {
    readText: jest.fn(async () => { if (onDisk instanceof Error) { throw onDisk; } return onDisk; }),
  };
  const bibtex: Partial<BibTeXService> = {
    writePaperArtifacts: jest.fn(async (_folder: string, paper: PaperRecord) => { written.push(paper); }),
  };
  const service = new PaperService(
    fsService as IFileSystem,
    db as IResearchDatabase,
    { emit: jest.fn(), on: jest.fn() } as unknown as EventBus,
    { papersRoot: () => vscode.Uri.file('/lib/papers') } as unknown as LibraryLayout<vscode.Uri>,
    {} as PdfImportParser,
    bibtex as BibTeXService,
  );
  return { service, written };
}

describe('PaperService keeps the reading status another app wrote', () => {
  it('keeps the on-disk status when rewriting resolved metadata', async () => {
    const { service, written } = makeService('title: Attention\nstatus: reading\n');
    await service.applyResolvedMetadata('vaswani2017', { title: 'Attention Is All You Need' });
    expect(written[0]).toMatchObject({ title: 'Attention Is All You Need', status: 'reading' });
  });

  it('writes the status the user just chose', async () => {
    const { service, written } = makeService('title: Attention\nstatus: reading\n');
    await service.updatePaperFields('vaswani2017', { status: 'done' });
    expect(written[0]!.status).toBe('done');
  });

  it('keeps the on-disk status when only tags change', async () => {
    const { service, written } = makeService('title: Attention\nstatus: reading\n');
    await service.updatePaperFields('vaswani2017', { tags: ['nlp'] });
    expect(written[0]).toMatchObject({ status: 'reading', tags: ['nlp'] });
  });

  it('falls back to the indexed status when metadata.yaml cannot be read', async () => {
    const { service, written } = makeService(new Error('ENOENT'));
    await service.applyResolvedMetadata('vaswani2017', { title: 'Attention Is All You Need' });
    expect(written[0]!.status).toBe('unread');
  });
});
