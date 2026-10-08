/**
 * Tests that metadata.yaml — what the index is rebuilt from on every start —
 * carries every field the library shows, and that rewriting it after import
 * keeps the name of the file the user originally imported.
 */
import YAML from 'yaml';

import { BibTeXService } from '@labshelf/core';
import type { IFileSystem, PaperRecord } from '@labshelf/core';

function memoryFs(initial: Record<string, string> = {}): IFileSystem & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    ensureDir: async () => undefined,
    writeText: async (p, content) => { files.set(p, content); },
    readText: async (p) => {
      const value = files.get(p);
      if (value === undefined) { throw new Error(`ENOENT ${p}`); }
      return value;
    },
    exists: async (p) => files.has(p),
  };
}

const paper = (overrides: Partial<PaperRecord> = {}): PaperRecord => ({
  id: 'imai1986', title: 'Efficient Algorithms', path: '/lib/papers/imai1986', citeKey: 'imai1986', status: 'unread', ...overrides,
});
const metadata = (fs: ReturnType<typeof memoryFs>) => YAML.parse(fs.files.get('/lib/papers/imai1986/metadata.yaml')!);

describe('BibTeXService.writePaperArtifacts', () => {
  it('writes the abstract, keywords and text layer so a restart does not drop them', async () => {
    const fs = memoryFs();
    const textLayer = { state: 'ocr' as const, ocrPages: 17, checkedAt: '2026-10-07T12:00:00.000Z' };

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({
      summary: 'In this paper, we show…', keywords: ['graph search'], textLayer,
    }), '/Users/me/Downloads/artigo-comp.pdf');

    expect(metadata(fs)).toMatchObject({ summary: 'In this paper, we show…', keywords: ['graph search'], textLayer, source: 'artigo-comp.pdf' });
  });

  it('keeps the original source name when rewriting from the library copy', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\nsource: artigo-comp.pdf\n' });

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), '/lib/papers/imai1986/paper.pdf');

    expect(metadata(fs).source).toBe('artigo-comp.pdf');
  });

  it('falls back to paper.pdf when there is no earlier name to keep', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': ':: not yaml' });

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');

    expect(metadata(fs).source).toBe('paper.pdf');
  });

  it('writes the tags and note a browser save attaches', async () => {
    const fs = memoryFs();

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ tags: ['geometry', 'to-read'], note: 'Cited in ch. 3' }), 'paper.pdf');

    expect(metadata(fs)).toMatchObject({ tags: ['geometry', 'to-read'], note: 'Cited in ch. 3' });
  });

  it('keeps tags, note and hand-added keys when a surface that does not know them rewrites the sidecar', async () => {
    const fs = memoryFs({
      '/lib/papers/imai1986/metadata.yaml': 'title: Old\nstatus: unread\ntags: [geometry]\nnote: Cited in ch. 3\nrating: 5\n',
    });

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ status: 'done' }), 'paper.pdf');

    expect(metadata(fs)).toMatchObject({ title: 'Efficient Algorithms', status: 'done', tags: ['geometry'], note: 'Cited in ch. 3', rating: 5 });
  });

  it('clears tags and note when the record explicitly empties them', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\ntags: [geometry]\nnote: old\n' });

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper({ tags: [], note: '' }), 'paper.pdf');

    expect(metadata(fs)).not.toHaveProperty('tags');
    expect(metadata(fs)).not.toHaveProperty('note');
  });

  it('never carries over a stale value for a field it owns', async () => {
    const fs = memoryFs({ '/lib/papers/imai1986/metadata.yaml': 'title: Old\ndoi: 10.1/old\nsummary: stale\n' });

    await new BibTeXService(fs).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');

    expect(metadata(fs)).not.toHaveProperty('doi');
    expect(metadata(fs)).not.toHaveProperty('summary');
  });

  it('writes the bib file line only when paper.pdf is in the folder', async () => {
    const withPdf = memoryFs({ '/lib/papers/imai1986/paper.pdf': 'PDF' });
    await new BibTeXService(withPdf).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');
    expect(withPdf.files.get('/lib/papers/imai1986/bib.bib')).toContain('file = {');

    // The browser saves a reference with no paper.pdf when it finds none: the
    // entry must not point LaTeX at a file that is not there.
    const noPdf = memoryFs();
    await new BibTeXService(noPdf).writePaperArtifacts('/lib/papers/imai1986', paper(), 'paper.pdf');
    expect(noPdf.files.get('/lib/papers/imai1986/bib.bib')).not.toContain('file =');
  });
});
