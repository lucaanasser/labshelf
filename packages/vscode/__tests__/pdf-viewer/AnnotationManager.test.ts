import * as vscode from 'vscode';
import { AnnotationManager } from '../../src/pdf-viewer/AnnotationManager';
import { PaperDataStore } from '../../src/storage/data/paperDataStore';
import { FileSystemService } from '../../src/storage/fileSystemService';
import { ExtensionEventBus } from '../../src/core/eventBus';
import { EVENTS } from '../../src/constants/events';

function makeFakeStore(): PaperDataStore {
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
  return new PaperDataStore(vscode.Uri.file('/lib/.research'), fs);
}

async function makeManager() {
  const store = makeFakeStore();
  const eventBus = new ExtensionEventBus();
  const manager = new AnnotationManager(store, eventBus);
  return { manager, store, eventBus };
}

describe('AnnotationManager', () => {
  // ── createHighlight ─────────────────────────────────────────────────────
  describe('createHighlight', () => {
    it('creates a highlight and returns it with id and timestamps', async () => {
      const { manager } = await makeManager();
      const ann = await manager.createHighlight(
        'paper-1', 1, 'selected text', 'yellow',
        { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
      );
      expect(ann.id).toBeTruthy();
      expect(ann.paperId).toBe('paper-1');
      expect(ann.type).toBe('highlight');
      expect(ann.pageNumber).toBe(1);
      expect(ann.content).toBe('selected text');
      expect(ann.color).toBe('yellow');
      expect(ann.position).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
      expect(ann.createdAt).toBeTruthy();
      expect(ann.updatedAt).toBeTruthy();
    });

    it('emits ANNOTATION_CREATED event', async () => {
      const { manager, eventBus } = await makeManager();
      const listener = jest.fn();
      eventBus.on(EVENTS.ANNOTATION_CREATED, listener);

      await manager.createHighlight('paper-1', 1, 'text', 'green');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'highlight' }));
    });

    it('rejects invalid color', async () => {
      const { manager } = await makeManager();
      await expect(
        manager.createHighlight('paper-1', 1, 'text', 'purple' as any),
      ).rejects.toThrow(/Invalid annotation color/);
    });

    it('rejects empty content', async () => {
      const { manager } = await makeManager();
      await expect(
        manager.createHighlight('paper-1', 1, '   ', 'yellow'),
      ).rejects.toThrow(/cannot be empty/);
    });

    it('rejects invalid page number', async () => {
      const { manager } = await makeManager();
      await expect(
        manager.createHighlight('paper-1', 0, 'text', 'yellow'),
      ).rejects.toThrow(/Invalid page number/);
    });

    it('creates highlight without position', async () => {
      const { manager } = await makeManager();
      const ann = await manager.createHighlight('paper-1', 1, 'text', 'blue');
      expect(ann.position).toBeUndefined();
    });

    it('accepts all valid highlight colors', async () => {
      const { manager } = await makeManager();
      const colors = ['yellow', 'green', 'blue', 'red', 'pink'] as const;
      for (const color of colors) {
        const ann = await manager.createHighlight('paper-1', 1, 'text', color);
        expect(ann.color).toBe(color);
      }
    });
  });

  // ── createNote ──────────────────────────────────────────────────────────
  describe('createNote', () => {
    it('creates a note annotation', async () => {
      const { manager } = await makeManager();
      const ann = await manager.createNote('paper-1', 2, 'My note');
      expect(ann.type).toBe('note');
      expect(ann.pageNumber).toBe(2);
      expect(ann.content).toBe('My note');
      expect(ann.color).toBeUndefined();
    });

    it('emits ANNOTATION_CREATED event', async () => {
      const { manager, eventBus } = await makeManager();
      const listener = jest.fn();
      eventBus.on(EVENTS.ANNOTATION_CREATED, listener);
      await manager.createNote('paper-1', 1, 'note');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('rejects empty content', async () => {
      const { manager } = await makeManager();
      await expect(manager.createNote('paper-1', 1, '')).rejects.toThrow(/cannot be empty/);
    });
  });

  // ── getAnnotationsByPaper ───────────────────────────────────────────────
  describe('getAnnotationsByPaper', () => {
    it('returns empty array when no annotations exist', async () => {
      const { manager } = await makeManager();
      const result = await manager.getAnnotationsByPaper('paper-1');
      expect(result).toEqual([]);
    });

    it('returns all annotations for a paper, sorted by page', async () => {
      const { manager } = await makeManager();
      await manager.createNote('paper-1', 3, 'Note page 3');
      await manager.createHighlight('paper-1', 1, 'Highlight page 1', 'yellow');
      await manager.createNote('paper-1', 2, 'Note page 2');

      const result = await manager.getAnnotationsByPaper('paper-1');
      expect(result).toHaveLength(3);
      expect(result[0]!.pageNumber).toBe(1);
      expect(result[1]!.pageNumber).toBe(2);
      expect(result[2]!.pageNumber).toBe(3);
    });

    it('does not return annotations from other papers', async () => {
      const { manager } = await makeManager();
      await manager.createNote('paper-1', 1, 'Paper 1 note');
      await manager.createNote('paper-2', 1, 'Paper 2 note');

      const result = await manager.getAnnotationsByPaper('paper-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.paperId).toBe('paper-1');
    });
  });

  // ── getAnnotationsByPage ────────────────────────────────────────────────
  describe('getAnnotationsByPage', () => {
    it('returns only annotations for the given page', async () => {
      const { manager } = await makeManager();
      await manager.createNote('paper-1', 1, 'Page 1 note');
      await manager.createNote('paper-1', 2, 'Page 2 note');

      const page1 = await manager.getAnnotationsByPage('paper-1', 1);
      expect(page1).toHaveLength(1);
      expect(page1[0]!.pageNumber).toBe(1);
    });
  });

  // ── updateAnnotation ────────────────────────────────────────────────────
  describe('updateAnnotation', () => {
    it('updates content and emits event', async () => {
      const { manager, eventBus } = await makeManager();
      const ann = await manager.createNote('paper-1', 1, 'original');
      const listener = jest.fn();
      eventBus.on(EVENTS.ANNOTATION_UPDATED, listener);

      const updated = await manager.updateAnnotation(ann.id, 'updated content');
      expect(updated.content).toBe('updated content');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ content: 'updated content' }));
    });

    it('throws when annotation not found', async () => {
      const { manager } = await makeManager();
      await expect(manager.updateAnnotation('nonexistent', 'content')).rejects.toThrow(/not found/);
    });

    it('rejects empty content', async () => {
      const { manager } = await makeManager();
      const ann = await manager.createNote('paper-1', 1, 'note');
      await expect(manager.updateAnnotation(ann.id, '  ')).rejects.toThrow(/cannot be empty/);
    });
  });

  // ── deleteAnnotation ────────────────────────────────────────────────────
  describe('deleteAnnotation', () => {
    it('removes annotation from DB and emits event', async () => {
      const { manager, eventBus } = await makeManager();
      const ann = await manager.createNote('paper-1', 1, 'to delete');
      const listener = jest.fn();
      eventBus.on(EVENTS.ANNOTATION_DELETED, listener);

      await manager.deleteAnnotation(ann.id, 'paper-1');

      const remaining = await manager.getAnnotationsByPaper('paper-1');
      expect(remaining).toHaveLength(0);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ annotationId: ann.id, paperId: 'paper-1' }),
      );
    });
  });

  // ── validatePosition ────────────────────────────────────────────────────
  describe('validatePosition', () => {
    it('accepts valid normalized positions', () => {
      const { manager } = { manager: new AnnotationManager(null as any, null as any) };
      expect(() => manager.validatePosition({ x: 0.1, y: 0.2, width: 0.5, height: 0.1 })).not.toThrow();
    });

    it('rejects non-object position', () => {
      const { manager } = { manager: new AnnotationManager(null as any, null as any) };
      expect(() => manager.validatePosition('invalid')).toThrow();
      expect(() => manager.validatePosition(null)).toThrow();
    });

    it('rejects non-numeric fields', () => {
      const { manager } = { manager: new AnnotationManager(null as any, null as any) };
      expect(() => manager.validatePosition({ x: '0.1', y: 0.2, width: 0.5, height: 0.1 })).toThrow();
    });

    it('rejects out-of-bounds positions', () => {
      const { manager } = { manager: new AnnotationManager(null as any, null as any) };
      expect(() => manager.validatePosition({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 })).toThrow();
      expect(() => manager.validatePosition({ x: -0.1, y: 0, width: 0.5, height: 0.1 })).toThrow();
    });
  });
});
