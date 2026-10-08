import * as vscode from 'vscode';
import { LibraryIndexer } from '../../src/storage/data/libraryIndexer';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';
import { LibraryPaths } from '../../src/storage/paths/libraryPaths';
import { InMemoryResearchDatabase } from '@labshelf/core';

// Fake FileSystemService backed by an in-memory map. readDirectory/readText are
// keyed by fsPath; directories are listed by their declared entries.
function makeFakeFs(opts: {
  files?: Record<string, string>;
  dirs?: Record<string, Array<[string, number]>>;
}): FileSystemService {
  const files = new Map(Object.entries(opts.files ?? {}));
  const dirs = new Map(Object.entries(opts.dirs ?? {}));
  const fs = new FileSystemService();
  jest.spyOn(fs, 'ensureDirectory').mockResolvedValue(undefined);
  jest.spyOn(fs, 'writeText').mockImplementation(async (uri, content) => {
    files.set(uri.fsPath, content);
  });
  jest.spyOn(fs, 'readText').mockImplementation(async (uri) => {
    const v = files.get(uri.fsPath);
    if (v === undefined) { throw new Error('ENOENT ' + uri.fsPath); }
    return v;
  });
  jest.spyOn(fs, 'exists').mockImplementation(async (uri) => files.has(uri.fsPath));
  jest.spyOn(fs, 'readDirectory').mockImplementation(async (uri) => {
    return (dirs.get(uri.fsPath) ?? []) as Array<[string, vscode.FileType]>;
  });
  return fs;
}

const F = vscode.FileType.File;
const D = vscode.FileType.Directory;

describe('LibraryIndexer', () => {
  it('rebuilds papers from metadata.yaml and annotations from sidecars', async () => {
    const root = vscode.Uri.file('/lib');
    const paths = new LibraryPaths(root);

    const sidecar = JSON.stringify({
      annotations: [
        { id: 'a1', paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'hi',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
      theme: 'dark',
    });

    const fs = makeFakeFs({
      files: {
        '/lib/papers/paper-1/metadata.yaml': 'title: First Paper\nstatus: reading\nyear: 2024\n',
        '/lib/.research/papers/paper-1/data.json': sidecar,
      },
      dirs: {
        '/lib/papers': [['paper-1', D]],
        '/lib/papers/paper-1': [['metadata.yaml', F]],
      },
    });

    const db = new InMemoryResearchDatabase();
    await db.initialize();
    const store = new PaperDataStore(paths.researchRoot(), fs);
    const indexer = new LibraryIndexer(paths, fs, db, store);

    const result = await indexer.rebuild();

    expect(result).toEqual({ papers: 1, annotations: 1 });
    const papers = await db.listPapers();
    expect(papers).toHaveLength(1);
    expect(papers[0]!.title).toBe('First Paper');
    expect(papers[0]!.status).toBe('reading');
    expect(await db.getAnnotationsByPaper('paper-1')).toHaveLength(1);
    expect(await db.getThemePreference('paper-1')).toBe('dark');
  });

  it('is idempotent: rebuilding twice does not duplicate data', async () => {
    const root = vscode.Uri.file('/lib');
    const paths = new LibraryPaths(root);
    const fs = makeFakeFs({
      files: {
        '/lib/papers/paper-1/metadata.yaml': 'title: P\n',
        '/lib/.research/papers/paper-1/data.json': JSON.stringify({
          annotations: [
            { id: 'a1', paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'x',
              createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          ],
          theme: 'auto',
        }),
      },
      dirs: {
        '/lib/papers': [['paper-1', D]],
        '/lib/papers/paper-1': [['metadata.yaml', F]],
      },
    });

    const db = new InMemoryResearchDatabase();
    await db.initialize();
    const store = new PaperDataStore(paths.researchRoot(), fs);
    const indexer = new LibraryIndexer(paths, fs, db, store);

    await indexer.rebuild();
    const second = await indexer.rebuild();

    expect(second).toEqual({ papers: 1, annotations: 1 });
    expect(await db.listPapers()).toHaveLength(1);
    expect(await db.getAnnotationsByPaper('paper-1')).toHaveLength(1);
  });

  it('recurses into nested folders to find paper folders', async () => {
    const root = vscode.Uri.file('/lib');
    const paths = new LibraryPaths(root);
    const fs = makeFakeFs({
      files: {
        '/lib/papers/topic/paper-1/metadata.yaml': 'title: Nested\n',
      },
      dirs: {
        '/lib/papers': [['topic', D]],
        '/lib/papers/topic': [['paper-1', D]],
        '/lib/papers/topic/paper-1': [['metadata.yaml', F]],
      },
    });

    const db = new InMemoryResearchDatabase();
    await db.initialize();
    const store = new PaperDataStore(paths.researchRoot(), fs);
    const indexer = new LibraryIndexer(paths, fs, db, store);

    const result = await indexer.rebuild();
    expect(result.papers).toBe(1);
    expect((await db.listPapers())[0]!.title).toBe('Nested');
  });

  it('returns zero counts when there are no papers', async () => {
    const root = vscode.Uri.file('/lib');
    const paths = new LibraryPaths(root);
    const fs = makeFakeFs({ dirs: { '/lib/papers': [] } });
    const db = new InMemoryResearchDatabase();
    await db.initialize();
    const store = new PaperDataStore(paths.researchRoot(), fs);
    const indexer = new LibraryIndexer(paths, fs, db, store);

    expect(await indexer.rebuild()).toEqual({ papers: 0, annotations: 0 });
  });
});

describe('LibraryIndexer — fields that only live in metadata.yaml', () => {
  it('restores the abstract, keywords and text layer verdict', async () => {
    const paths = new LibraryPaths(vscode.Uri.file('/lib'));
    const fs = makeFakeFs({
      files: {
        '/lib/papers/scan/metadata.yaml': [
          'title: Efficient Algorithms',
          'summary: We show many graph search problems can be solved efficiently.',
          'keywords: [graph search, geometry, 42]',
          'textLayer: { state: ocr, ocrPages: 17, checkedAt: "2026-10-07T12:00:00.000Z" }',
        ].join('\n'),
        '/lib/papers/bad/metadata.yaml': 'title: Bad\ntextLayer: { state: scanned }\nkeywords: nope\n',
      },
      dirs: {
        '/lib/papers': [['scan', D], ['bad', D]],
        '/lib/papers/scan': [['metadata.yaml', F]],
        '/lib/papers/bad': [['metadata.yaml', F]],
      },
    });
    const db = new InMemoryResearchDatabase();
    await db.initialize();

    await new LibraryIndexer(paths, fs, db, new PaperDataStore(paths.researchRoot(), fs)).rebuild();
    const byId = new Map((await db.listPapers()).map((paper) => [paper.id, paper]));

    expect(byId.get('scan')).toMatchObject({
      summary: 'We show many graph search problems can be solved efficiently.',
      keywords: ['graph search', 'geometry'],
      textLayer: { state: 'ocr', ocrPages: 17, checkedAt: '2026-10-07T12:00:00.000Z' },
    });
    expect(byId.get('bad')).not.toHaveProperty('textLayer');
    expect(byId.get('bad')).not.toHaveProperty('keywords');
  });
});

describe('LibraryIndexer — hasPdf derived from the folder listing', () => {
  const SYMLINK = vscode.FileType.SymbolicLink;

  function fsWith(entries: Array<[string, number]>): { paths: LibraryPaths; fs: FileSystemService; db: InMemoryResearchDatabase } {
    const paths = new LibraryPaths(vscode.Uri.file('/lib'));
    const fs = makeFakeFs({
      files: { '/lib/papers/p/metadata.yaml': 'title: P\n' },
      dirs: { '/lib/papers': [['p', D]], '/lib/papers/p': entries as Array<[string, vscode.FileType]> },
    });
    return { paths, fs, db: new InMemoryResearchDatabase() };
  }

  it.each([
    ['a real PDF beside metadata', [['metadata.yaml', F], ['paper.pdf', F]], true],
    ['a symlink to a PDF (File|SymbolicLink bit)', [['metadata.yaml', F], ['paper.pdf', F | SYMLINK]], true],
    ['only metadata and bib', [['metadata.yaml', F], ['bib.bib', F]], false],
    ['a directory named paper.pdf', [['metadata.yaml', F], ['paper.pdf', D]], false],
  ])('sets hasPdf for %s', async (_name, entries, expected) => {
    const { paths, fs, db } = fsWith(entries as Array<[string, number]>);
    await db.initialize();
    await new LibraryIndexer(paths, fs, db, new PaperDataStore(paths.researchRoot(), fs)).rebuild();
    expect((await db.listPapers())[0]!.hasPdf).toBe(expected);
  });

  it('derives the flag from the listing walk already made, with no extra directory or stat call', async () => {
    const { paths, fs, db } = fsWith([['metadata.yaml', F], ['paper.pdf', F]]);
    await db.initialize();
    (vscode.workspace.fs.stat as jest.Mock).mockClear();
    const readDirectory = fs.readDirectory as unknown as jest.Mock;
    readDirectory.mockClear();
    await new LibraryIndexer(paths, fs, db, new PaperDataStore(paths.researchRoot(), fs)).rebuild();
    // papers/ and the one paper folder — the PDF presence reuses that listing.
    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
  });
});
