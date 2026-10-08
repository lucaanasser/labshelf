/**
 * Integration tests for the papers table of SqliteResearchDatabase on a real
 * SQLite file: the text-layer verdict round-trips, and a value it cannot trust is
 * dropped instead of breaking the list.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as vscode from 'vscode';

import type { IResearchDatabase, PaperRecord } from '@labshelf/core';
import { createSqliteResearchDatabase } from '../../src/db/sqliteResearchDatabase';
import { FileSystemService } from '../../src/storage/fileSystemService';

const paper = (overrides: Partial<PaperRecord> = {}): PaperRecord => ({
  id: 'imai1986', title: 'Efficient Algorithms', path: '/lib/papers/imai1986', citeKey: 'imai1986', status: 'unread', ...overrides,
});

let dir: string;
let database: IResearchDatabase;

async function open(file: string): Promise<IResearchDatabase> {
  const fsService = new FileSystemService();
  jest.spyOn(fsService, 'ensureDirectory').mockResolvedValue(undefined);
  const db = await createSqliteResearchDatabase(vscode.Uri.file(file), fsService);
  await db.initialize();
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-sqlite-'));
});
afterEach(() => {
  (database as unknown as { connection?: DatabaseSync })?.connection?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SqliteResearchDatabase — papers', () => {
  it('round-trips the text layer verdict, summary and keywords', async () => {
    database = await open(path.join(dir, 'index.sqlite'));
    const textLayer = { state: 'ocr' as const, ocrPages: 17, failedPages: 1, checkedAt: '2026-10-07T12:00:00.000Z' };

    await database.upsertPaper(paper({ textLayer, summary: 'We show…', keywords: ['graphs', 'geometry'] }));
    const [stored] = await database.listPapers();

    expect(stored).toMatchObject({ textLayer, summary: 'We show…', keywords: ['graphs', 'geometry'] });
  });

  it('clears the verdict when the record no longer carries one', async () => {
    database = await open(path.join(dir, 'index.sqlite'));
    await database.upsertPaper(paper({ textLayer: { state: 'native', checkedAt: 'x' } }));
    await database.upsertPaper(paper());

    expect((await database.listPapers())[0]).not.toHaveProperty('textLayer');
  });

  it('round-trips hasPdf true and false', async () => {
    database = await open(path.join(dir, 'index.sqlite'));
    await database.upsertPaper(paper({ id: 'yes', hasPdf: true }));
    await database.upsertPaper(paper({ id: 'no', hasPdf: false }));

    const byId = new Map((await database.listPapers()).map((p) => [p.id, p]));
    expect(byId.get('yes')!.hasPdf).toBe(true);
    expect(byId.get('no')!.hasPdf).toBe(false);
  });

  it('leaves hasPdf absent (unknown = present) when the record does not carry it', async () => {
    database = await open(path.join(dir, 'index.sqlite'));
    await database.upsertPaper(paper());
    expect((await database.listPapers())[0]).not.toHaveProperty('hasPdf');
  });

  it('updates has_pdf on upsert, and clears it back to unknown', async () => {
    database = await open(path.join(dir, 'index.sqlite'));
    await database.upsertPaper(paper({ hasPdf: false }));
    await database.upsertPaper(paper({ hasPdf: true }));
    expect((await database.listPapers())[0]!.hasPdf).toBe(true);
    await database.upsertPaper(paper());
    expect((await database.listPapers())[0]).not.toHaveProperty('hasPdf');
  });

  it('drops a stored verdict it cannot trust', async () => {
    const file = path.join(dir, 'index.sqlite');
    database = await open(file);
    await database.upsertPaper(paper({ textLayer: { state: 'native', checkedAt: 'x' } }));
    const raw = (database as unknown as { rawConnection(): DatabaseSync }).rawConnection();
    raw.prepare(`UPDATE papers SET text_layer = ?`).run('{"state":"scanned"}');

    expect((await database.listPapers())[0]).not.toHaveProperty('textLayer');
    raw.prepare(`UPDATE papers SET text_layer = ?`).run('not json');
    expect((await database.listPapers())[0]).not.toHaveProperty('textLayer');
  });
});
