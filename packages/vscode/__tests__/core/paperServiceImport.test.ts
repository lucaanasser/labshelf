import * as vscode from 'vscode';
import {
  PAPERS_ROOT, existingFolders, importOnEmptyLibrary, makeParsedPdf, makeService, makeUri, resetFsMocks,
} from './paperServiceHarness';

beforeEach(resetFsMocks);

describe('PaperService.addPaperFromUri', () => {
  importOnEmptyLibrary();
  it('imports a single PDF and emits paper:added', async () => {
    const svc = makeService();
    const uri = makeUri('/docs/paper.pdf');
    const paper = await svc.addPaperFromUri(uri);

    expect(paper.title).toBe('Test Paper');
    expect(paper.status).toBe('unread');
    // The PDF was just written into the library, so the import carries one.
    expect(paper.hasPdf).toBe(true);

    const bus = (svc as any).eventBus;
    expect(bus.emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ title: 'Test Paper' }));
  });
});

describe('PaperService.addPaperFromUri — paper ids', () => {
  importOnEmptyLibrary();
  const writtenPaths = () => (vscode.workspace.fs.writeFile as jest.Mock).mock.calls.map(([uri]) => uri.fsPath);

  it('gives a second paper with the same key a suffix and leaves the first paper untouched', async () => {
    const seeded = { id: 'testpaper2024', title: 'Seeded', citeKey: 'testpaper2024', path: `${PAPERS_ROOT}/testpaper2024`, status: 'unread' };
    const svc = makeService({ dbPapers: [seeded] });

    const first = await svc.addPaperFromUri(makeUri('/docs/x.pdf'));
    const second = await svc.addPaperFromUri(makeUri('/docs/y.pdf'));

    expect(first.id).toBe('testpaper2024a');
    expect(first.citeKey).toBe('testpaper2024a');
    expect(first.path).toBe(`${PAPERS_ROOT}/testpaper2024a`);
    expect(second.id).toBe('testpaper2024b');
    expect(writtenPaths()).toEqual([
      `${PAPERS_ROOT}/testpaper2024a/paper.pdf`,
      `${PAPERS_ROOT}/testpaper2024b/paper.pdf`,
    ]);
    const rows = await (svc as any).database.listPapers();
    expect(rows.find((row: any) => row.id === 'testpaper2024').title).toBe('Seeded');
  });

  it('treats ids that differ only in case as taken', async () => {
    const svc = makeService({ dbPapers: [{ id: 'TestPaper2024', title: 'Seeded', path: `${PAPERS_ROOT}/TestPaper2024` }] });
    const paper = await svc.addPaperFromUri(makeUri('/docs/x.pdf'));
    expect(paper.id).toBe('testpaper2024a');
  });

  it('skips a folder that exists on disk without a database row', async () => {
    existingFolders.add(`${PAPERS_ROOT}/testpaper2024`);
    const svc = makeService();
    const paper = await svc.addPaperFromUri(makeUri('/docs/x.pdf'));
    expect(paper.id).toBe('testpaper2024a');
    expect(writtenPaths()).toEqual([`${PAPERS_ROOT}/testpaper2024a/paper.pdf`]);
  });

  it('checks the target collection folder, not the library root', async () => {
    existingFolders.add(`${PAPERS_ROOT}/ML/testpaper2024`);
    const svc = makeService();
    const paper = await svc.addPaperFromUri(makeUri('/docs/x.pdf'), makeUri(`${PAPERS_ROOT}/ML`));
    expect(paper.path).toBe(`${PAPERS_ROOT}/ML/testpaper2024a`);
  });

  it('names the folder after the slugged file name when no cite key is found', async () => {
    const svc = makeService({ parsedPdf: makeParsedPdf({ citeKey: undefined }) });
    const paper = await svc.addPaperFromUri(makeUri('/docs/My Paper v2.pdf'));
    expect(paper.id).toBe('mypaperv2');
    expect(paper.path).toBe(`${PAPERS_ROOT}/mypaperv2`);
  });
});

describe('PaperService.addPapersFromUris — PDF files', () => {
  importOnEmptyLibrary();
  it('imports a list of PDF URIs and returns success entries', async () => {
    const svc = makeService();
    const uris = [makeUri('/docs/a.pdf'), makeUri('/docs/b.pdf')];
    const result = await svc.addPapersFromUris(uris);

    expect(result.success).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    // Both PDFs parse to the same cite key; the second gets a suffix instead of reusing the folder.
    expect(result.success.map((paper) => paper.id)).toEqual(['testpaper2024', 'testpaper2024a']);
  });

  it('reports each PDF, in order, just before importing it', async () => {
    const svc = makeService();
    const steps: Array<{ index: number; total: number; fileName: string }> = [];
    await svc.addPapersFromUris(
      [makeUri('/docs/a.pdf'), makeUri('/docs/readme.txt'), makeUri('/docs/b.pdf')],
      undefined,
      (step) => steps.push(step),
    );

    // Skipped files are not steps: the total counts only what will be imported.
    expect(steps).toEqual([
      { index: 1, total: 2, fileName: 'a.pdf' },
      { index: 2, total: 2, fileName: 'b.pdf' },
    ]);
  });

  it('skips non-PDF files and records them in skipped', async () => {
    const svc = makeService();
    const uris = [makeUri('/docs/paper.pdf'), makeUri('/docs/readme.txt')];
    const result = await svc.addPapersFromUris(uris);

    expect(result.success).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('readme.txt');
  });

  it('records a failed item in failed and continues with the rest', async () => {
    let callCount = 0;
    const svc = makeService({
      parsedPdf: null, // will trigger parse to be overridden below
    });

    // Make parse fail on the second call only
    (svc as any).pdfImportParser.parse = jest.fn(async () => {
      callCount++;
      if (callCount === 2) throw new Error('parse failed');
      return makeParsedPdf({ citeKey: `paper${callCount}` });
    });

    const uris = [makeUri('/docs/good.pdf'), makeUri('/docs/bad.pdf'), makeUri('/docs/also-good.pdf')];
    const result = await svc.addPapersFromUris(uris);

    expect(result.success).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.path).toContain('bad.pdf');
    expect(result.failed[0]!.error).toBe('parse failed');
  });

  it('returns empty result for an empty URI list', async () => {
    const svc = makeService();
    const result = await svc.addPapersFromUris([]);
    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('PaperService.addPapersFromUris — folder expansion', () => {
  importOnEmptyLibrary();
  it('expands a folder URI and imports all PDFs inside', async () => {
    const folderUri = makeUri('/docs/myfolder');
    const svc = makeService({
      fsStatResult: (uri) => ({
        type: uri.fsPath === folderUri.fsPath ? vscode.FileType.Directory : vscode.FileType.File,
      }),
      fsReadDir: () => [
        ['paper1.pdf', vscode.FileType.File],
        ['paper2.pdf', vscode.FileType.File],
        ['notes.txt', vscode.FileType.File],
      ],
    });

    const result = await svc.addPapersFromUris([folderUri]);

    expect(result.success).toHaveLength(2);
    expect(result.skipped).toHaveLength(0); // txt is filtered, not in skipped (only non-pdf top-level files go to skipped)
    expect(result.failed).toHaveLength(0);
  });

  it('recurses into sub-folders and collects all PDFs', async () => {
    const rootUri = makeUri('/docs/root');
    const subUri = makeUri('/docs/root/sub');

    const svc = makeService({
      fsStatResult: (uri) => ({
        type: uri.fsPath === rootUri.fsPath ? vscode.FileType.Directory : vscode.FileType.File,
      }),
      fsReadDir: (uri) => {
        if (uri.fsPath === rootUri.fsPath) {
          return [
            ['top.pdf', vscode.FileType.File],
            ['sub', vscode.FileType.Directory],
          ];
        }
        return [['nested.pdf', vscode.FileType.File]];
      },
    });

    const result = await svc.addPapersFromUris([rootUri]);
    expect(result.success).toHaveLength(2);
  });

  it('handles an unreadable folder gracefully and returns empty success', async () => {
    const folderUri = makeUri('/docs/locked');
    const svc = makeService({
      fsStatResult: () => ({ type: vscode.FileType.Directory }),
      fsReadDir: () => { throw new Error('permission denied'); },
    });

    const result = await svc.addPapersFromUris([folderUri]);
    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
