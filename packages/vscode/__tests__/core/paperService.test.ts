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
