import * as vscode from 'vscode';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';

// In-memory FileSystemService: keeps a fsPath -> content map so tests do not
// touch the real disk while exercising the sidecar read-modify-write paths.
function makeFakeFs(): FileSystemService {
  const files = new Map<string, string>();
  const fs = new FileSystemService();
  jest.spyOn(fs, 'ensureDirectory').mockResolvedValue(undefined);
  jest.spyOn(fs, 'writeText').mockImplementation(async (uri, content) => {
    files.set(uri.fsPath, content);
  });
  jest.spyOn(fs, 'readText').mockImplementation(async (uri) => {
    const v = files.get(uri.fsPath);
    if (v === undefined) { throw new Error('ENOENT'); }
    return v;
  });
  jest.spyOn(fs, 'exists').mockImplementation(async (uri) => files.has(uri.fsPath));
  return fs;
}

function makeStore(): PaperDataStore {
  return new PaperDataStore(vscode.Uri.file('/lib/.research'), makeFakeFs());
}

describe('PaperDataStore', () => {
  describe('load', () => {
    it('returns empty data when the sidecar is missing', async () => {
      const store = makeStore();
      const data = await store.load('paper-1');
      expect(data).toEqual({ annotations: [], theme: 'auto' });
    });
  });

  describe('addAnnotation', () => {
    it('creates an annotation with id and timestamps', async () => {
      const store = makeStore();
      const ann = await store.addAnnotation('paper-1', {
        paperId: 'paper-1',
        type: 'highlight',
        pageNumber: 2,
        content: 'hello',
        color: 'yellow',
      });
      expect(ann.id).toBeTruthy();
      expect(ann.createdAt).toBeTruthy();
      expect(ann.updatedAt).toBeTruthy();
      expect(ann.paperId).toBe('paper-1');
      const reloaded = await store.getAnnotations('paper-1');
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]!.id).toBe(ann.id);
    });

    it('persists multiple annotations', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'a' });
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 2, content: 'b' });
      expect(await store.getAnnotations('paper-1')).toHaveLength(2);
    });
  });

  describe('updateAnnotation', () => {
    it('updates content and bumps updatedAt', async () => {
      const store = makeStore();
      const ann = await store.addAnnotation('paper-1', {
        paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'old',
      });
      const updated = await store.updateAnnotation('paper-1', ann.id, 'new');
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('new');
      const reloaded = await store.getAnnotations('paper-1');
      expect(reloaded[0]!.content).toBe('new');
    });

    it('returns null for an unknown id', async () => {
      const store = makeStore();
      expect(await store.updateAnnotation('paper-1', 'missing', 'x')).toBeNull();
    });
  });

  describe('deleteAnnotation', () => {
    it('removes the annotation from the sidecar', async () => {
      const store = makeStore();
      const ann = await store.addAnnotation('paper-1', {
        paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'gone',
      });
      await store.deleteAnnotation('paper-1', ann.id);
      expect(await store.getAnnotations('paper-1')).toHaveLength(0);
    });

    it('is a no-op for an unknown id', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'keep' });
      await store.deleteAnnotation('paper-1', 'missing');
      expect(await store.getAnnotations('paper-1')).toHaveLength(1);
    });
  });

  describe('getAnnotations', () => {
    it('sorts annotations by page number', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 3, content: 'c' });
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'a' });
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 2, content: 'b' });
      const result = await store.getAnnotations('paper-1');
      expect(result.map((a) => a.pageNumber)).toEqual([1, 2, 3]);
    });
  });

  describe('getAnnotationsByPage', () => {
    it('returns only annotations on the given page', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'a' });
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 2, content: 'b' });
      const page1 = await store.getAnnotationsByPage('paper-1', 1);
      expect(page1).toHaveLength(1);
      expect(page1[0]!.pageNumber).toBe(1);
    });
  });

  describe('setTheme / getTheme', () => {
    it('defaults to auto when nothing is stored', async () => {
      const store = makeStore();
      expect(await store.getTheme('paper-1')).toBe('auto');
    });

    it('persists and retrieves a theme', async () => {
      const store = makeStore();
      await store.setTheme('paper-1', 'sepia');
      expect(await store.getTheme('paper-1')).toBe('sepia');
    });

    it('keeps theme and annotations independent', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'a' });
      await store.setTheme('paper-1', 'dark');
      const data = await store.load('paper-1');
      expect(data.theme).toBe('dark');
      expect(data.annotations).toHaveLength(1);
    });
  });
});
