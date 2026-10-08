import {
  PaperDataStore,
  emptyPaperData,
  normalizePaperData,
  serializePaperData,
  validateAnnotationPosition,
  type SidecarPort,
} from '../../src/reader/paperData';

function memoryPort(seed: Record<string, string> = {}): SidecarPort & { files: Record<string, string>; writes: number } {
  const port = {
    files: { ...seed },
    writes: 0,
    async read(id: string) { return port.files[id] ?? null; },
    async write(id: string, text: string) { port.writes++; port.files[id] = text; },
  };
  return port;
}

let seq = 0;
const store = (port: SidecarPort) => new PaperDataStore(port, { now: () => '2026-10-07T12:00:00.000Z', newId: () => `id-${++seq}` });

describe('normalizePaperData', () => {
  it('returns empty data for anything that is not an object', () => {
    expect(normalizePaperData(null)).toEqual(emptyPaperData());
    expect(normalizePaperData([])).toEqual(emptyPaperData());
    expect(normalizePaperData('x')).toEqual(emptyPaperData());
  });

  it('drops malformed annotations, unknown themes and an unusable reading state', () => {
    const data = normalizePaperData({ annotations: [{ id: 'a' }, { nope: 1 }, null], theme: 'neon', reading: { page: 0 } });
    expect(data.annotations).toEqual([{ id: 'a' }]);
    expect(data.theme).toBe('auto');
    expect(data.reading).toBeUndefined();
  });

  it('keeps a valid reading state', () => {
    const data = normalizePaperData({ annotations: [], theme: 'sepia', reading: { page: 3, scaleValue: 'page-width', updatedAt: 't' } });
    expect(data.theme).toBe('sepia');
    expect(data.reading).toEqual({ page: 3, scaleValue: 'page-width', updatedAt: 't' });
  });
});

describe('serializePaperData', () => {
  it('writes the VS Code sidecar format: fixed key order, two-space indent, reading only when set', () => {
    expect(serializePaperData({ annotations: [], theme: 'auto' })).toBe('{\n  "annotations": [],\n  "theme": "auto"\n}');
    const withReading = serializePaperData({ reading: { page: 2, scaleValue: '1.5', updatedAt: 't' }, theme: 'dark', annotations: [] });
    expect(Object.keys(JSON.parse(withReading))).toEqual(['annotations', 'theme', 'reading']);
  });
});

describe('validateAnnotationPosition', () => {
  it('accepts a normalized box and rejects anything outside the page', () => {
    expect(validateAnnotationPosition({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
    expect(() => validateAnnotationPosition({ x: 0.9, y: 0, width: 0.2, height: 0.1 })).toThrow('normalized');
    expect(() => validateAnnotationPosition({ x: '0' })).toThrow('numbers');
    expect(() => validateAnnotationPosition(null)).toThrow('object');
  });
});

describe('PaperDataStore', () => {
  it('returns empty data when the sidecar is absent or corrupt', async () => {
    expect(await store(memoryPort()).load('p')).toEqual(emptyPaperData());
    expect(await store(memoryPort({ p: '{not json' })).load('p')).toEqual(emptyPaperData());
  });

  it('adds highlights and notes, and lists them by page then creation time', async () => {
    const port = memoryPort();
    const s = store(port);
    await s.addHighlight('p', 3, 'later page', 'blue');
    const h = await s.addHighlight('p', 1, 'first', 'yellow', { x: 0, y: 0, width: 0.5, height: 0.1 });
    await s.addNote('p', 2, 'a note');
    expect(h).toMatchObject({ type: 'highlight', color: 'yellow', paperId: 'p', createdAt: '2026-10-07T12:00:00.000Z' });
    expect((await s.getAnnotations('p')).map((a) => a.pageNumber)).toEqual([1, 2, 3]);
    const note = (await s.getAnnotations('p')).find((a) => a.type === 'note')!;
    expect(note).not.toHaveProperty('color');
    expect(note).not.toHaveProperty('position');
  });

  it('rejects invalid colors, pages and empty content without writing', async () => {
    const port = memoryPort();
    const s = store(port);
    await expect(s.addHighlight('p', 1, 'x', 'purple')).rejects.toThrow('Invalid annotation color');
    await expect(s.addHighlight('p', 0, 'x', 'red')).rejects.toThrow('Invalid page number');
    await expect(s.addHighlight('p', 1, '  ', 'red')).rejects.toThrow('cannot be empty');
    await expect(s.addNote('p', 1, '')).rejects.toThrow('cannot be empty');
    expect(port.writes).toBe(0);
  });

  it('updates and deletes annotations; unknown ids fail or no-op without a write', async () => {
    const port = memoryPort();
    const s = store(port);
    const a = await s.addNote('p', 1, 'old');
    expect((await s.updateAnnotation('p', a.id, 'new')).content).toBe('new');
    await expect(s.updateAnnotation('p', 'missing', 'x')).rejects.toThrow('not found');
    const before = port.writes;
    expect(await s.deleteAnnotation('p', 'missing')).toBe(false);
    expect(port.writes).toBe(before);
    expect(await s.deleteAnnotation('p', a.id)).toBe(true);
    expect(await s.getAnnotations('p')).toEqual([]);
  });

  it('serializes concurrent writes so none is lost', async () => {
    const port = memoryPort();
    const s = store(port);
    await Promise.all([
      s.setTheme('p', 'sepia'),
      s.setReadingState('p', { page: 4, scaleValue: 'page-fit', updatedAt: 't' }),
      s.addNote('p', 1, 'n1'),
      s.addNote('p', 2, 'n2'),
    ]);
    const data = await s.load('p');
    expect(data.theme).toBe('sepia');
    expect(data.reading?.page).toBe(4);
    expect(data.annotations).toHaveLength(2);
    expect(await s.getTheme('p')).toBe('sepia');
    expect((await s.getReadingState('p'))?.scaleValue).toBe('page-fit');
  });

  it('keeps going after a failed write', async () => {
    const port = memoryPort();
    let fail = true;
    const flaky: SidecarPort = { read: port.read, write: async (id, t) => { if (fail) { fail = false; throw new Error('disk'); } await port.write(id, t); } };
    const s = store(flaky);
    await expect(s.setTheme('p', 'dark')).rejects.toThrow('disk');
    await s.setTheme('p', 'light');
    expect(await s.getTheme('p')).toBe('light');
  });
});
