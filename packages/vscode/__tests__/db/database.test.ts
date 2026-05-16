/**
 * Tests the ResearchDatabase interface contract using InMemoryResearchDatabase.
 * SqliteResearchDatabase integration tests require a compatible better-sqlite3
 * build (run `npm rebuild` if NODE_MODULE_VERSION mismatches).
 */
import { InMemoryResearchDatabase } from '../../src/db/database';
import type { PaperRecord } from '../../src/core/types';

function makePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: 'paper-2024',
    title: 'Test Paper',
    path: '/tmp/papers/paper-2024',
    citeKey: 'paper2024',
    status: 'unread',
    ...overrides,
  };
}

describe('InMemoryResearchDatabase', () => {
  let db: InMemoryResearchDatabase;

  beforeEach(async () => {
    db = new InMemoryResearchDatabase();
    await db.initialize();
  });

  describe('initialize', () => {
    it('initializes without throwing', async () => {
      const fresh = new InMemoryResearchDatabase();
      await expect(fresh.initialize()).resolves.not.toThrow();
    });
  });

  describe('upsertPaper / listPapers', () => {
    it('inserts a paper and returns it via listPapers', async () => {
      await db.upsertPaper(makePaper());
      const list = await db.listPapers();
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('paper-2024');
      expect(list[0]!.title).toBe('Test Paper');
    });

    it('upserts (updates) existing paper on re-insert with same id', async () => {
      await db.upsertPaper(makePaper());
      await db.upsertPaper(makePaper({ title: 'Updated Title' }));
      const list = await db.listPapers();
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe('Updated Title');
    });

    it('preserves optional fields', async () => {
      const paper = makePaper({ authors: ['Alice', 'Bob'], year: 2024, doi: '10.000/test' });
      await db.upsertPaper(paper);
      const stored = (await db.listPapers())[0]!;
      expect(stored.authors).toEqual(['Alice', 'Bob']);
      expect(stored.year).toBe(2024);
      expect(stored.doi).toBe('10.000/test');
    });

    it('returns empty array when no papers exist', async () => {
      const list = await db.listPapers();
      expect(list).toHaveLength(0);
    });

    it('stores multiple independent papers', async () => {
      await db.upsertPaper(makePaper({ id: 'a', title: 'Paper A', citeKey: 'a' }));
      await db.upsertPaper(makePaper({ id: 'b', title: 'Paper B', citeKey: 'b' }));
      const list = await db.listPapers();
      expect(list).toHaveLength(2);
    });
  });

  describe('deletePaper', () => {
    it('removes the paper by id', async () => {
      await db.upsertPaper(makePaper());
      await db.deletePaper('paper-2024');
      const list = await db.listPapers();
      expect(list).toHaveLength(0);
    });

    it('does not throw when deleting a non-existent id', async () => {
      await expect(db.deletePaper('nonexistent')).resolves.not.toThrow();
    });

    it('does not affect other papers when one is deleted', async () => {
      await db.upsertPaper(makePaper({ id: 'a', citeKey: 'a' }));
      await db.upsertPaper(makePaper({ id: 'b', citeKey: 'b' }));
      await db.deletePaper('a');
      const list = await db.listPapers();
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('b');
    });
  });

  describe('appendLog', () => {
    it('accepts log entries without throwing', async () => {
      await expect(db.appendLog({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        module: 'test',
        message: 'hello',
        context: {},
      })).resolves.not.toThrow();
    });
  });
});
