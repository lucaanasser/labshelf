import * as vscode from 'vscode';
import { PaperService } from '../../src/core/paperService';
import type { IResearchDatabase, ExtensionEventBus, PdfImportParser, BibTeXService } from '@labshelf/core';
import type { FileSystemService } from '../../src/storage/fileSystemService';
import type { ILibraryPaths } from '../../src/storage/paths/libraryPaths';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

function makeParsedPdf(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Paper',
    citeKey: 'testpaper2024',
    authors: ['Alice', 'Bob'],
    year: 2024,
    ...overrides,
  };
}

function makeService(overrides: {
  dbPapers?: any[];
  parsedPdf?: any;
  fsStatResult?: (uri: vscode.Uri) => { type: number };
  fsReadDir?: (uri: vscode.Uri) => [string, number][];
  textLayerBuilder?: { build: jest.Mock };
} = {}): PaperService {
  const mockDb: Partial<IResearchDatabase> = {
    upsertPaper: jest.fn(async () => {}),
    listPapers: jest.fn(async () => overrides.dbPapers ?? []),
    deletePaper: jest.fn(async () => {}),
    appendLog: jest.fn(async () => {}),
  };

  const mockEventBus: Partial<ExtensionEventBus> = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  const mockFsService: Partial<FileSystemService> = {
    ensureDirectory: jest.fn(async () => {}),
    writeText: jest.fn(async () => {}),
  };

  const mockPaths: Partial<ILibraryPaths> = {
    papersRoot: jest.fn(() => makeUri('/workspace/papers')),
  };

  const mockParser: Partial<PdfImportParser> = {
    parse: jest.fn(async () => overrides.parsedPdf ?? makeParsedPdf()),
  };

  const mockBibTeX: Partial<BibTeXService> = {
    writePaperArtifacts: jest.fn(async () => {}),
  };

  // Override workspace.fs behaviour per test
  if (overrides.fsStatResult) {
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(
      async (uri: vscode.Uri) => overrides.fsStatResult!(uri),
    );
  }
  if (overrides.fsReadDir) {
    (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(
      async (uri: vscode.Uri) => overrides.fsReadDir!(uri),
    );
  }

  return new PaperService(
    mockFsService as FileSystemService,
    mockDb as IResearchDatabase,
    mockEventBus as ExtensionEventBus,
    mockPaths as ILibraryPaths,
    mockParser as PdfImportParser,
    mockBibTeX as BibTeXService,
    overrides.textLayerBuilder,
  );
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: any URI is a file
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
  (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
  (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('pdf-bytes'));
  (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
});

describe('PaperService.addPaperFromUri', () => {
  it('imports a single PDF and emits paper:added', async () => {
    const svc = makeService();
    const uri = makeUri('/docs/paper.pdf');
    const paper = await svc.addPaperFromUri(uri);

    expect(paper.title).toBe('Test Paper');
    expect(paper.status).toBe('unread');

    const bus = (svc as any).eventBus;
    expect(bus.emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ title: 'Test Paper' }));
  });
});

describe('PaperService.addPapersFromUris — PDF files', () => {
  it('imports a list of PDF URIs and returns success entries', async () => {
    const svc = makeService();
    const uris = [makeUri('/docs/a.pdf'), makeUri('/docs/b.pdf')];
    const result = await svc.addPapersFromUris(uris);

    expect(result.success).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
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

// ─── organizing: movePapers / moveFolder ──────────────────────────────────────

describe('PaperService.movePapers', () => {
  const stored = [
    { id: 'p1', title: 'One', path: '/workspace/papers/A/p1' },
    { id: 'p2', title: 'Two', path: '/workspace/papers/B/p2' },
  ];

  beforeEach(() => {
    (vscode.workspace.fs.rename as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('renames the paper folder into the target and re-points the record', async () => {
    const service = makeService({ dbPapers: stored });
    const result = await service.movePapers(['p1'], '/workspace/papers/B');

    expect(result).toEqual({ moved: ['p1'], failed: [] });
    const [from, to, options] = (vscode.workspace.fs.rename as jest.Mock).mock.calls[0];
    expect(from.fsPath).toBe('/workspace/papers/A/p1');
    expect(to.fsPath).toBe('/workspace/papers/B/p1');
    expect(options).toEqual({ overwrite: false });
  });

  it('skips papers already in the target folder', async () => {
    const service = makeService({ dbPapers: stored });
    const result = await service.movePapers(['p2'], '/workspace/papers/B');

    expect(result).toEqual({ moved: [], failed: [] });
    expect(vscode.workspace.fs.rename).not.toHaveBeenCalled();
  });

  it('reports unknown ids and filesystem collisions without aborting the batch', async () => {
    (vscode.workspace.fs.rename as jest.Mock).mockRejectedValueOnce(new Error('EEXIST'));
    const service = makeService({ dbPapers: stored });
    const result = await service.movePapers(['p1', 'ghost', 'p2'], '/workspace/papers/C');

    expect(result.moved).toEqual(['p2']);
    expect(result.failed).toEqual([
      { id: 'p1', error: 'EEXIST' },
      { id: 'ghost', error: 'Paper not found' },
    ]);
  });
});

describe('PaperService.moveFolder', () => {
  beforeEach(() => {
    (vscode.workspace.fs.rename as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('moves the folder under the new parent and returns its new path', async () => {
    const service = makeService({ dbPapers: [{ id: 'p1', title: 'One', path: '/workspace/papers/A/p1' }] });
    const moved = await service.moveFolder('/workspace/papers/A', '/workspace/papers/B');

    expect(moved).toBe('/workspace/papers/B/A');
    const [from, to] = (vscode.workspace.fs.rename as jest.Mock).mock.calls[0];
    expect([from.fsPath, to.fsPath]).toEqual(['/workspace/papers/A', '/workspace/papers/B/A']);
  });

  it('refuses to move a folder into itself or its own subtree', async () => {
    const service = makeService();
    await expect(service.moveFolder('/workspace/papers/A', '/workspace/papers/A/B')).rejects.toThrow('into itself');
    await expect(service.moveFolder('/workspace/papers/A', '/workspace/papers/A')).rejects.toThrow('into itself');
    expect(vscode.workspace.fs.rename).not.toHaveBeenCalled();
  });

  it('refuses a no-op move to the current parent', async () => {
    const service = makeService();
    await expect(service.moveFolder('/workspace/papers/A', '/workspace/papers')).rejects.toThrow('already there');
  });
});

describe('PaperService.resolvePdfUri', () => {
  it('follows the stored path, so papers inside collection folders resolve', async () => {
    const service = makeService({ dbPapers: [{ id: 'p1', title: 'One', path: '/workspace/papers/Project/Refs/p1' }] });
    expect((await service.resolvePdfUri('p1'))?.fsPath).toBe('/workspace/papers/Project/Refs/p1/paper.pdf');
  });

  it('returns null for an unknown id', async () => {
    expect(await makeService().resolvePdfUri('ghost')).toBeNull();
  });
});

describe('PaperService.makeSearchable', () => {
  const stored = { id: 'scan1986', title: 'A Scan', path: '/workspace/papers/scan1986', citeKey: 'scan1986', status: 'unread' };

  beforeEach(() => {
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async () => new Uint8Array([1, 2, 3]));
  });

  it('replaces paper.pdf through a temporary file and announces the update', async () => {
    const bytes = new Uint8Array([9, 9]);
    const builder = { build: jest.fn(async () => ({ status: 'added', bytes, pagesAdded: 17, pagesFailed: 0 })) };
    const svc = makeService({ dbPapers: [stored], textLayerBuilder: builder });

    const result = await svc.makeSearchable('scan1986');

    expect(result).toMatchObject({ status: 'added', pagesAdded: 17 });
    const [pending, written] = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0];
    expect(pending.fsPath).toBe('/workspace/papers/scan1986/paper.searchable.tmp');
    expect(written).toBe(bytes);
    const [from, to, options] = (vscode.workspace.fs.rename as jest.Mock).mock.calls[0];
    expect([from.fsPath, to.fsPath, options]).toEqual([pending.fsPath, '/workspace/papers/scan1986/paper.pdf', { overwrite: true }]);
    expect((svc as any).eventBus.emit).toHaveBeenCalledWith('paper:updated', stored);
  });

  it.each(['not-needed', 'cancelled'])('leaves the file alone when the outcome is %s', async (status) => {
    const svc = makeService({ dbPapers: [stored], textLayerBuilder: { build: jest.fn(async () => ({ status })) } });

    expect(await svc.makeSearchable('scan1986')).toEqual({ status });
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect((svc as any).eventBus.emit).not.toHaveBeenCalled();
  });

  it('reports why nothing happened when OCR is off, the paper is unknown, or the builder throws', async () => {
    expect(await makeService({ dbPapers: [stored] }).makeSearchable('scan1986')).toMatchObject({ status: 'unavailable' });

    const builder = { build: jest.fn(async () => { throw new Error('boom'); }) };
    const svc = makeService({ dbPapers: [stored], textLayerBuilder: builder });
    expect(await svc.makeSearchable('missing')).toEqual({ status: 'unavailable', reason: 'paper not found' });
    expect(await svc.makeSearchable('scan1986')).toEqual({ status: 'unavailable', reason: 'boom' });
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
