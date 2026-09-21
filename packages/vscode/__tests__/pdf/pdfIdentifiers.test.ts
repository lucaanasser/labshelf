/**
 * Unit tests for the identifier-detection heuristics that scan a PDF's
 * metadata, link annotations and text for DOI/arXiv/PMID/PMCID/ISBN
 * candidates, and for the title-overlap scoring used to confirm an online
 * match.
 */

import { detectIdentifiers, doiVariants, titleOverlap } from '@labshelf/core';

describe('detectIdentifiers', () => {
  it('finds multiple DOIs in the text and dedupes repeats', () => {
    const text = '10.1038/nature12373 is cited elsewhere as 10.1038/nature12373';

    const identifiers = detectIdentifiers({}, text);

    expect(identifiers.filter((identifier) => identifier.type === 'doi')).toEqual([
      { type: 'doi', value: '10.1038/nature12373' },
    ]);
  });

  it('finds a PMID from a labelled reference', () => {
    const identifiers = detectIdentifiers({}, 'PMID: 28796665');

    expect(identifiers).toContainEqual({ type: 'pmid', value: '28796665' });
  });

  it('finds a PMC id and upper-cases it', () => {
    const identifiers = detectIdentifiers({}, 'available at PMC5560867');

    expect(identifiers).toContainEqual({ type: 'pmcid', value: 'PMC5560867' });
  });

  it('finds an ISBN', () => {
    const identifiers = detectIdentifiers({}, 'ISBN: 978-3-16-148410-0');

    expect(identifiers).toContainEqual({ type: 'isbn', value: '9783161484100' });
  });

  it('finds an arXiv id from an explicit label', () => {
    const identifiers = detectIdentifiers({}, 'arXiv:1706.03762v7');

    expect(identifiers).toContainEqual({ type: 'arxiv', value: '1706.03762' });
  });

  it('finds an arXiv id from a link URL', () => {
    const identifiers = detectIdentifiers({}, '', ['https://arxiv.org/abs/1706.03762']);

    expect(identifiers).toContainEqual({ type: 'arxiv', value: '1706.03762' });
  });

  it('does not treat a bare decimal number as an arXiv id without context', () => {
    const identifiers = detectIdentifiers({}, 'pages 1706.03762 of volume 12');

    expect(identifiers.some((identifier) => identifier.type === 'arxiv')).toBe(false);
  });

  it('recovers a DOI split across text items', () => {
    const identifiers = detectIdentifiers({}, 'https://doi.org/10.1038/ nature12373');

    expect(identifiers).toContainEqual({ type: 'doi', value: '10.1038/nature12373' });
  });

  it('ranks a labelled identifier ahead of an earlier unlabelled match', () => {
    const text = 'References 10.9999/old.reference ... doi:10.1038/nature12373';

    const identifiers = detectIdentifiers({}, text);

    expect(identifiers[0]).toEqual({ type: 'doi', value: '10.1038/nature12373' });
  });
});

describe('doiVariants', () => {
  it('expands a component DOI into itself and its parent article DOI', () => {
    expect(doiVariants('10.7554/eLife.28383.001')).toEqual([
      '10.7554/eLife.28383.001',
      '10.7554/eLife.28383',
    ]);
  });

  it('returns only the DOI itself when there is no numeric component suffix', () => {
    expect(doiVariants('10.1038/nature12373')).toEqual(['10.1038/nature12373']);
  });
});

describe('titleOverlap', () => {
  it('scores identical strings as a full match', () => {
    const title = 'Attention Is All You Need';

    expect(titleOverlap(title, title)).toBe(1);
  });

  it('scores a candidate title fully contained in a longer page as a full match', () => {
    const candidate = 'Attention Is All You Need';
    const page =
      'NeurIPS 2017\nAttention Is All You Need\nAshish Vaswani, Noam Shazeer, et al.\nAbstract...';

    expect(titleOverlap(candidate, page)).toBe(1);
  });

  it('scores a completely different title as a low match', () => {
    expect(
      titleOverlap('Attention Is All You Need', 'A Survey of Deep Reinforcement Learning'),
    ).toBeLessThan(0.3);
  });

  it('returns 0 for an empty candidate', () => {
    expect(titleOverlap('', 'Attention Is All You Need')).toBe(0);
  });
});
