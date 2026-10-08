/**
 * Unit tests for reindexLibrary: after the indexer rebuilds from disk, it emits
 * the right paper events and queues a text-layer check for PDFs that just
 * appeared, without touching an unchanged library.
 */
import { InMemoryResearchDatabase } from '@labshelf/core';
import type { PaperRecord } from '@labshelf/core';
import { reindexLibrary } from '../../src/storage/data/reindexLibrary';

const rec = (over: Partial<PaperRecord>): PaperRecord => ({
  id: 'p', title: 'P', path: '/lib/papers/p', citeKey: 'p', status: 'unread', ...over,
});

// A stand-in indexer whose rebuild() upserts the state the disk now holds.
function indexerThatWrites(db: InMemoryResearchDatabase, next: PaperRecord[]) {
  return { rebuild: jest.fn(async () => { for (const p of next) { await db.upsertPaper(p); } return { papers: next.length, annotations: 0 }; }) };
}

async function freshDb(seed: PaperRecord[] = []): Promise<InMemoryResearchDatabase> {
  const db = new InMemoryResearchDatabase();
  await db.initialize();
  for (const p of seed) { await db.upsertPaper(p); }
  return db;
}

describe('reindexLibrary', () => {
  it('emits paper:updated and queues a check when a PDF appears', async () => {
    const db = await freshDb([rec({ id: 'a', hasPdf: false })]);
    const emit = jest.fn();
    const queueCheck = jest.fn();

    const summary = await reindexLibrary({
      database: db,
      indexer: indexerThatWrites(db, [rec({ id: 'a', hasPdf: true })]),
      eventBus: { emit } as never,
      queueCheck,
    });

    expect(summary).toEqual({ added: [], updated: ['a'] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', hasPdf: true }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['a']);
  });

  it('emits paper:added for a new folder and queues its check', async () => {
    const db = await freshDb();
    const emit = jest.fn();
    const queueCheck = jest.fn();

    const summary = await reindexLibrary({
      database: db,
      indexer: indexerThatWrites(db, [rec({ id: 'new', hasPdf: true })]),
      eventBus: { emit } as never,
      queueCheck,
    });

    expect(summary).toEqual({ added: ['new'], updated: [] });
    expect(emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ id: 'new' }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['new']);
  });

  it('does nothing — no events, no check — for an unchanged library', async () => {
    const same = rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } });
    const db = await freshDb([same]);
    const emit = jest.fn();
    const queueCheck = jest.fn();

    const summary = await reindexLibrary({
      database: db,
      indexer: indexerThatWrites(db, [rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } })]),
      eventBus: { emit } as never,
      queueCheck,
    });

    expect(summary).toEqual({ added: [], updated: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does not re-check an updated paper that already had its PDF', async () => {
    const db = await freshDb([rec({ id: 'a', hasPdf: true, title: 'Old' })]);
    const emit = jest.fn();
    const queueCheck = jest.fn();

    const summary = await reindexLibrary({
      database: db,
      indexer: indexerThatWrites(db, [rec({ id: 'a', hasPdf: true, title: 'New' })]),
      eventBus: { emit } as never,
      queueCheck,
    });

    expect(summary).toEqual({ added: [], updated: ['a'] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', title: 'New' }));
    expect(queueCheck).not.toHaveBeenCalled();
  });
});
