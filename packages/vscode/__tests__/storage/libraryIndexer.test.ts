import * as vscode from 'vscode';
import { LibraryIndexer } from '../../src/storage/data/libraryIndexer';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';
import { LibraryPaths } from '../../src/storage/paths/libraryPaths';
import { InMemoryResearchDatabase } from '../../src/db/database';

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
