import * as vscode from 'vscode';
import { libraryLayout, type IFileSystem } from '@labshelf/core';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { makeMemoryFileSystem } from '../support/memoryFileSystem';

function makeFakeFs(): IFileSystem {
  return makeMemoryFileSystem();
}

function makeStore(): PaperDataStore {
  return new PaperDataStore(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), makeFakeFs());
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

  describe('reading state', () => {
    const reading = { page: 7, scaleValue: 'page-width', left: 0, top: 412.5, updatedAt: '2026-02-03T10:00:00.000Z' };

    it('is null until the paper has been read', async () => {
      expect(await makeStore().getReadingState('paper-1')).toBeNull();
    });

    it('round-trips the position, zoom and sidebar state', async () => {
      const store = makeStore();
      const withSidebar = { ...reading, sidebar: { open: true, tab: 'outline' as const, width: 260 } };
      await store.setReadingState('paper-1', withSidebar);
      expect(await store.getReadingState('paper-1')).toEqual(withSidebar);
    });

    it('leaves annotations and theme untouched', async () => {
      const store = makeStore();
      await store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'a' });
      await store.setTheme('paper-1', 'sepia');
      await store.setReadingState('paper-1', reading);
      const data = await store.load('paper-1');
      expect(data.annotations).toHaveLength(1);
      expect(data.theme).toBe('sepia');
      expect(data.reading).toEqual(reading);
    });

    it('does not write a reading key for papers that were never read', async () => {
      const fs = makeFakeFs();
      const store = new PaperDataStore(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), fs);
      await store.setTheme('paper-1', 'dark');
      const written = (fs.writeText as jest.Mock).mock.calls.at(-1)![1] as string;
      expect(JSON.parse(written)).toEqual({ annotations: [], theme: 'dark' });
    });

    it('loads a legacy sidecar that has no reading key', async () => {
      const fs = makeFakeFs();
      const store = new PaperDataStore(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), fs);
      await fs.writeText('/lib/.research/papers/paper-1/data.json', JSON.stringify({ annotations: [], theme: 'dark' }));
      expect(await store.load('paper-1')).toEqual({ annotations: [], theme: 'dark' });
    });

    it('drops a corrupt reading value instead of failing the load', async () => {
      const fs = makeFakeFs();
      const store = new PaperDataStore(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), fs);
      await fs.writeText(
        '/lib/.research/papers/paper-1/data.json',
        JSON.stringify({ annotations: [], theme: 'sepia', reading: { page: 'seven', scaleValue: 12 } }),
      );
      const data = await store.load('paper-1');
      expect(data.theme).toBe('sepia');
      expect(data.reading).toBeUndefined();
    });
  });

  describe('write queue', () => {
    // Makes every write slow enough that un-serialized load-modify-save cycles would overlap and lose updates.
    function makeSlowStore() {
      const fs = makeFakeFs();
      const realWrite = (fs.writeText as jest.Mock).getMockImplementation()!;
      (fs.writeText as jest.Mock).mockImplementation(async (uri, content) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return realWrite(uri, content);
      });
      return { fs, store: new PaperDataStore(libraryLayout(vscode.Uri.file('/lib'), vscode.Uri.joinPath), fs) };
    }

    it('keeps every concurrent mutation of the same paper', async () => {
      const { store } = makeSlowStore();
      const reading = { page: 3, scaleValue: '1.5', updatedAt: '2026-02-03T10:00:00.000Z' };
      await Promise.all([
        store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 1, content: 'first' }),
        store.setReadingState('paper-1', reading),
        store.addAnnotation('paper-1', { paperId: 'paper-1', type: 'note', pageNumber: 2, content: 'second' }),
        store.setTheme('paper-1', 'dark'),
      ]);
      const data = await store.load('paper-1');
      expect(data.annotations.map((a) => a.content).sort()).toEqual(['first', 'second']);
      expect(data.reading).toEqual(reading);
      expect(data.theme).toBe('dark');
    });

    it('does not serialize different papers behind each other', async () => {
      const { store } = makeSlowStore();
      await Promise.all([
        store.setTheme('paper-1', 'dark'),
        store.setTheme('paper-2', 'sepia'),
      ]);
      expect(await store.getTheme('paper-1')).toBe('dark');
      expect(await store.getTheme('paper-2')).toBe('sepia');
    });

    it('keeps processing after a failed write', async () => {
      const { fs, store } = makeSlowStore();
      (fs.writeText as jest.Mock).mockImplementationOnce(async () => { throw new Error('disk full'); });
      const failed = store.setTheme('paper-1', 'dark');
      const next = store.setTheme('paper-1', 'sepia');
      await expect(failed).rejects.toThrow('disk full');
      await next;
      expect(await store.getTheme('paper-1')).toBe('sepia');
    });
  });
});
