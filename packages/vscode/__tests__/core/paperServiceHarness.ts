/** Shared fakes for the PaperService suites: an in-memory database, a stubbed parser and library-folder stat answers. */
import * as vscode from 'vscode';
import { PaperService } from '../../src/core/paperService';
import type { LibraryLayout, IResearchDatabase, EventBus, PdfImportParser, BibTeXService } from '@labshelf/core';
import type { FileSystemService } from '../../src/storage/fileSystemService';

export const PAPERS_ROOT = '/workspace/papers';

// Folders that exist on disk under the library; every other library path is free.
export const existingFolders = new Set<string>();

// Import suites call this: a library folder resolves only when listed in existingFolders (import probes for free
// cite keys), any other URI answers with `otherwise`.
function statLike(otherwise: (uri: vscode.Uri) => { type: number }) {
  return async (uri: vscode.Uri) => {
    if (uri.fsPath.startsWith(`${PAPERS_ROOT}/`)) {
      if (existingFolders.has(uri.fsPath)) { return { type: vscode.FileType.Directory }; }
      throw new Error('ENOENT');
    }
    return otherwise(uri);
  };
}

export function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

export function makeParsedPdf(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Paper',
    citeKey: 'testpaper2024',
    authors: ['Alice', 'Bob'],
    year: 2024,
    ...overrides,
  };
}

export function makeService(overrides: {
  dbPapers?: any[];
  parsedPdf?: any;
  fsStatResult?: (uri: vscode.Uri) => { type: number };
  fsReadDir?: (uri: vscode.Uri) => [string, number][];
  textLayerBuilder?: { build?: jest.Mock; detect?: jest.Mock };
} = {}): PaperService {
  // Upserts land in the list, so a later read sees them as the real index would.
  const rows: any[] = overrides.dbPapers ?? [];
  const mockDb: Partial<IResearchDatabase> = {
    upsertPaper: jest.fn(async (paper: any) => {
      const at = rows.findIndex((row) => row.id === paper.id);
      if (at === -1) { rows.push(paper); } else { rows[at] = paper; }
    }),
    listPapers: jest.fn(async () => rows.map((row) => ({ ...row }))),
    deletePaper: jest.fn(async () => {}),
    appendLog: jest.fn(async () => {}),
  };

  const mockEventBus: Partial<EventBus> = {
    emit: jest.fn(),
    on: jest.fn(),
  };

  const mockFsService: Partial<FileSystemService> = {
    ensureDirectory: jest.fn(async () => {}),
    writeText: jest.fn(async () => {}),
  };

  const mockPaths: Partial<LibraryLayout<vscode.Uri>> = {
    papersRoot: jest.fn(() => makeUri(PAPERS_ROOT)),
  };

  const mockParser: Partial<PdfImportParser> = {
    parse: jest.fn(async () => overrides.parsedPdf ?? makeParsedPdf()),
  };

  const mockBibTeX: Partial<BibTeXService> = {
    writePaperArtifacts: jest.fn(async () => {}),
  };

  // Override workspace.fs behaviour per test
  if (overrides.fsStatResult) {
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(statLike(overrides.fsStatResult));
  }
  if (overrides.fsReadDir) {
    (vscode.workspace.fs.readDirectory as jest.Mock).mockImplementation(
      async (uri: vscode.Uri) => overrides.fsReadDir!(uri),
    );
  }

  return new PaperService(
    mockFsService as FileSystemService,
    mockDb as IResearchDatabase,
    mockEventBus as EventBus,
    mockPaths as LibraryLayout<vscode.Uri>,
    mockParser as PdfImportParser,
    mockBibTeX as BibTeXService,
    overrides.textLayerBuilder as any,
  );
}

// Default file-system answers for every PaperService suite: any URI is a file, PDFs read and write.
export function resetFsMocks(): void {
  jest.clearAllMocks();
  existingFolders.clear();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
  (vscode.workspace.fs.readDirectory as jest.Mock).mockResolvedValue([]);
  (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('pdf-bytes'));
  (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
}

export function importOnEmptyLibrary(): void {
  beforeEach(() => {
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(statLike(() => ({ type: vscode.FileType.File })));
  });
}
