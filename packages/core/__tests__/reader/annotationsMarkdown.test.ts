import type { Annotation } from '@labshelf/core';
import { formatAnnotationsMarkdown } from '../../src/reader/annotationsMarkdown';
import type { CitablePaper } from '../../src/reader/citationFormat';

function paper(overrides: Partial<CitablePaper> = {}): CitablePaper {
  return { citeKey: 'doe2020', title: 'Great Paper', authors: ['Jane Doe'], year: 2020, ...overrides };
}

function annotation(overrides: Partial<Annotation> & Pick<Annotation, 'type' | 'pageNumber' | 'content' | 'createdAt'>): Annotation {
  return {
    id: 'ann-1',
    paperId: 'paper-1',
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

describe('formatAnnotationsMarkdown', () => {
  it('renders the title/author header and "_No annotations._" for an empty list', () => {
    const result = formatAnnotationsMarkdown(paper({ title: 'My Great Paper', citeKey: 'nasser2024' }), []);
    expect(result).toBe('# My Great Paper\n\nDoe, 2020 · `@nasser2024`\n\n_No annotations._\n');
  });

  it('ends with a trailing newline even when there are annotations', () => {
    const result = formatAnnotationsMarkdown(
      paper(),
      [annotation({ type: 'note', pageNumber: 1, content: 'x', createdAt: '2024-01-01T00:00:00.000Z' })],
    );
    expect(result.endsWith('\n')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(false);
  });

  it('groups annotations under one "## Page N" heading per page, in ascending page order', () => {
    const result = formatAnnotationsMarkdown(paper(), [
      annotation({ type: 'note', pageNumber: 3, content: 'third', createdAt: '2024-01-03T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'first-a', createdAt: '2024-01-01T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 2, content: 'second', createdAt: '2024-01-02T00:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'first-b', createdAt: '2024-01-01T01:00:00.000Z' }),
    ]);

    expect(result.match(/## Page 1/g)).toHaveLength(1);
    expect(result.match(/## Page 2/g)).toHaveLength(1);
    expect(result.match(/## Page 3/g)).toHaveLength(1);

    const p1 = result.indexOf('## Page 1');
    const p2 = result.indexOf('## Page 2');
    const p3 = result.indexOf('## Page 3');
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });

  it('renders a highlight as a block quote with a colour comment and a pandoc citation', () => {
    const result = formatAnnotationsMarkdown(paper({ citeKey: 'doe2020' }), [
      annotation({ type: 'highlight', pageNumber: 5, content: 'quoted text', color: 'green', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('> quoted text');
    expect(result).toContain('<!-- highlight: green --> [@doe2020, p. 5]');
  });

  it('defaults the highlight colour comment to "yellow" when no colour is set', () => {
    const result = formatAnnotationsMarkdown(paper(), [
      annotation({ type: 'highlight', pageNumber: 1, content: 'quoted text', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('<!-- highlight: yellow -->');
  });

  it('renders a note as "**Note:** <content>"', () => {
    const result = formatAnnotationsMarkdown(paper(), [
      annotation({ type: 'note', pageNumber: 1, content: 'Remember this detail', createdAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    expect(result).toContain('**Note:** Remember this detail');
  });

  it('orders annotations within the same page by createdAt ascending', () => {
    const result = formatAnnotationsMarkdown(paper(), [
      annotation({ type: 'note', pageNumber: 1, content: 'later note', createdAt: '2024-01-01T10:00:00.000Z' }),
      annotation({ type: 'note', pageNumber: 1, content: 'earlier note', createdAt: '2024-01-01T09:00:00.000Z' }),
    ]);
    expect(result.indexOf('earlier note')).toBeLessThan(result.indexOf('later note'));
  });

  it('produces the exact expected document for a mixed highlight/note, multi-page case', () => {
    const p = paper({ title: 'Great Paper', citeKey: 'doe2020', authors: ['Jane Doe'], year: 2020 });
    const annotations: Annotation[] = [
      annotation({ type: 'note', pageNumber: 2, content: 'Second page note', createdAt: '2024-01-02T00:00:00.000Z' }),
      annotation({ type: 'highlight', pageNumber: 1, content: 'later highlight text', createdAt: '2024-01-01T10:00:00.000Z' }),
      annotation({ type: 'highlight', pageNumber: 1, content: 'first highlight text', color: 'green', createdAt: '2024-01-01T09:00:00.000Z' }),
    ];

    const expected = [
      '# Great Paper', '', 'Doe, 2020 · `@doe2020`', '',
      '## Page 1', '',
      '> first highlight text', '', '<!-- highlight: green --> [@doe2020, p. 1]', '',
      '> later highlight text', '', '<!-- highlight: yellow --> [@doe2020, p. 1]', '',
      '## Page 2', '',
      '**Note:** Second page note', '',
    ].join('\n');

    expect(formatAnnotationsMarkdown(p, annotations)).toBe(expected);
  });
});
