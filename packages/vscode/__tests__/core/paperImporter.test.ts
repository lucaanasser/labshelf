import { makeGlue, pdfBytes, PAPERS_ROOT } from './paperServiceHarness';

describe('PaperImporter', () => {
  it('imports a PDF, then indexes it and announces it', async () => {
    const g = makeGlue();
    await g.fs.writeFile('/docs/a.pdf', pdfBytes());

    const outcomes = await g.importer.importPaths(['/docs/a.pdf']);

    expect(outcomes).toEqual([expect.objectContaining({ status: 'added', record: expect.objectContaining({ id: 'testpaper2024' }) })]);
    expect(await g.fs.exists(`${PAPERS_ROOT}/testpaper2024/paper.pdf`)).toBe(true);
    expect(g.rows.map((row) => row.id)).toEqual(['testpaper2024']);
    expect(g.emitted).toEqual([['paper:added', expect.objectContaining({ id: 'testpaper2024', hasPdf: true })]]);
  });

  it('indexes each paper as soon as its file is done, before the next file starts', async () => {
    const g = makeGlue();
    await g.fs.writeFile('/docs/a.pdf', pdfBytes('a'));
    await g.fs.writeFile('/docs/b.pdf', pdfBytes('b'));
    const indexedWhenStarting: number[] = [];

    await g.importer.importPaths(['/docs/a.pdf', '/docs/b.pdf'], undefined, () => indexedWhenStarting.push(g.rows.length));

    expect(indexedWhenStarting).toEqual([0, 1]);
    expect(g.emitted.map(([name]) => name)).toEqual(['paper:added', 'paper:added']);
  });

  it('does not import a PDF whose DOI is already in the library', async () => {
    const g = makeGlue();
    await g.seed('vaswani2017', { doi: '10.5555/Attention' });
    await g.fs.writeFile('/docs/again.pdf', pdfBytes());
    g.parse.mockResolvedValue({ title: 'Attention', citeKey: 'vaswani2017b', doi: '10.5555/attention' });

    const outcomes = await g.importer.importPaths(['/docs/again.pdf']);

    expect(outcomes).toEqual([{ status: 'duplicate', existingId: 'vaswani2017', input: '/docs/again.pdf' }]);
    expect(g.rows.map((row) => row.id)).toEqual(['vaswani2017']);
    expect(g.emitted).toEqual([]);
  });

  it('avoids ids the index already holds, ignoring case', async () => {
    const g = makeGlue();
    g.rows.push({ id: 'TestPaper2024', title: 'Seeded', path: '/elsewhere/TestPaper2024', citeKey: 'x', status: 'unread' });
    await g.fs.writeFile('/docs/a.pdf', pdfBytes());

    const [outcome] = await g.importer.importPaths(['/docs/a.pdf'], `${PAPERS_ROOT}/ML`);

    expect(outcome).toMatchObject({ status: 'added', record: { id: 'testpaper2024a', path: `${PAPERS_ROOT}/ML/testpaper2024a` } });
  });

  it('indexes nothing for a failed import', async () => {
    const g = makeGlue();
    await g.fs.writeText('/docs/readme.pdf', 'not a pdf');

    const outcomes = await g.importer.importPaths(['/docs/readme.pdf']);

    expect(outcomes).toEqual([{ status: 'failed', error: 'Not a PDF file', input: '/docs/readme.pdf' }]);
    expect(g.indexWrites).toEqual([]);
  });
});
