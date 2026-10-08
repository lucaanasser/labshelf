/** The paper glue over the real core mutations: an in-memory disk, an index that records its writes, and an event spy. */
import * as path from 'node:path';
import { BibTeXService, type EventBus, type ILogger, type IResearchDatabase, type MutationContext, type PaperRecord } from '@labshelf/core';

import { PaperImporter } from '../../src/core/paperImporter';
import { PaperService } from '../../src/core/paperService';
import { PaperTextLayers } from '../../src/core/paperTextLayers';
import { MemoryLibraryFs } from '../support/memoryLibraryFs';

export const PAPERS_ROOT = '/lib/papers';

// JSON values are valid YAML flow scalars and sequences.
const asYaml = (meta: Record<string, unknown>): string =>
  Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`).join('');

export const pdfBytes = (body = 'fake'): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);

export interface Glue {
  fs: MemoryLibraryFs;
  ctx: MutationContext;
  rows: PaperRecord[];
  emitted: Array<[string, unknown]>;
  /** Index writes, in order; each entry is "upsert:<id>" or "delete:<id>". */
  indexWrites: string[];
  service: PaperService;
  importer: PaperImporter;
  textLayers: (builder?: { build?: jest.Mock; detect?: jest.Mock }) => PaperTextLayers;
  parse: jest.Mock;
  /** Writes a paper to disk and to the index, the way a rebuild would find it. */
  seed: (id: string, meta?: Record<string, unknown>, dir?: string) => Promise<PaperRecord>;
}

export function makeGlue(): Glue {
  const fs = new MemoryLibraryFs();
  const rows: PaperRecord[] = [];
  const emitted: Array<[string, unknown]> = [];
  const indexWrites: string[] = [];
  const database = {
    listPapers: jest.fn(async () => rows.map((row) => ({ ...row }))),
    upsertPaper: jest.fn(async (paper: PaperRecord) => {
      indexWrites.push(`upsert:${paper.id}`);
      const at = rows.findIndex((row) => row.id === paper.id);
      if (at === -1) { rows.push(paper); } else { rows[at] = paper; }
    }),
    deletePaper: jest.fn(async (id: string) => {
      indexWrites.push(`delete:${id}`);
      const at = rows.findIndex((row) => row.id === id);
      if (at !== -1) { rows.splice(at, 1); }
    }),
  } as unknown as IResearchDatabase;
  const eventBus = { emit: jest.fn((name: string, payload: unknown) => { emitted.push([name, payload]); }) } as unknown as EventBus;
  const logger: ILogger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const bibtex = new BibTeXService(fs);
  const ctx: MutationContext = { fs, paths: path, artifacts: bibtex, logger, papersRoot: PAPERS_ROOT, now: () => '2026-01-01T00:00:00.000Z' };
  const parse = jest.fn(async () => ({ title: 'Test Paper', citeKey: 'testpaper2024', authors: ['Alice'], year: 2024 }));
  const service = new PaperService(ctx, database, eventBus, bibtex, parse);
  void fs.mkdir(PAPERS_ROOT);
  return {
    fs, ctx, rows, emitted, indexWrites, service, parse,
    importer: new PaperImporter(ctx, database, eventBus, parse),
    textLayers: (builder) => new PaperTextLayers(ctx, service, builder as never),
    async seed(id, meta = {}, dir = PAPERS_ROOT) {
      const folder = `${dir}/${id}`;
      await fs.writeText(`${folder}/metadata.yaml`, asYaml({ title: `Title ${id}`, status: 'unread', ...meta }));
      await fs.writeFile(`${folder}/paper.pdf`, pdfBytes());
      const record: PaperRecord = { id, title: `Title ${id}`, path: folder, citeKey: id, status: 'unread', hasPdf: true, ...meta } as PaperRecord;
      rows.push(record);
      return record;
    },
  };
}
