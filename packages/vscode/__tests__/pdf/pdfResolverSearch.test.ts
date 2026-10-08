/**
 * Unit tests for how a registry search hit is accepted: a record must be
 * printed in the text searched with — in one place, and ahead of any other
 * candidate — not merely share words with it.
 */

import { searchOnlineByText } from '@labshelf/core';

const FRONT_MATTER = [
  'SIAM J. COMPUT. 1986 Society for Industrial and Applied Mathematics Vol. 15, No. 2, May 1986',
  'EFFICIENT ALGORITHMS FOR GEOMETRIC 5 GRAPH SEARCH PROBLEMS* HIROSHI IMAI AND TAKAO ASANO',
  'Abstract. In this paper, we show that many graph search problems can be solved quite efficiently.',
  'We first extract several basic operations for depth first search and breadth first search on a graph',
  'and then show how those operations can be executed on a geometric intersection graph of segments.',
].join(' ');

// Serves the given works from CrossRef and nothing from every other registry.
function mockCrossRef(works: Array<{ title: string; DOI: string; abstract?: string }>): void {
  global.fetch = jest.fn(async (url: string) => {
    const items = String(url).includes('api.crossref.org')
      ? works.map((work) => ({ title: [work.title], DOI: work.DOI, abstract: work.abstract }))
      : [];
    return { ok: true, text: async () => JSON.stringify({ message: { items } }) };
  }) as unknown as typeof fetch;
}

describe('searchOnlineByText', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a short title whose words merely occur in the page', async () => {
    mockCrossRef([{ title: 'Depth First Search', DOI: '10.1017/cbo9781139015165.006' }]);

    expect(await searchOnlineByText(FRONT_MATTER)).toBeUndefined();
  });

  it('rejects a short title that is missing one of its words from the page', async () => {
    // Three of the four words appear together; "critical" does not.
    const page = [
      'From fitness landscapes to seascapes: non-equilibrium dynamics of selection and adaptation',
      'Ville Mustonen and Michael Lassig. Evolution is a quest for innovation. Organisms adapt to changing',
      'natural selection by evolving new phenotypes. Can we read this dynamics in their genomes?',
    ].join(' ');
    mockCrossRef([{ title: 'Non equilibrium critical dynamics', DOI: '10.1017/cbo9781139046213.011' }]);

    expect(await searchOnlineByText(page)).toBeUndefined();
  });

  it('prefers the title printed first over a fuller record found later in the page', async () => {
    mockCrossRef([
      { title: 'Basic operations for breadth first search on a graph', DOI: '10.1000/later', abstract: 'x'.repeat(200) },
      { title: 'Efficient Algorithms for Geometric Graph Search Problems', DOI: '10.1137/0215033' },
    ]);

    expect((await searchOnlineByText(FRONT_MATTER))?.doi).toBe('10.1137/0215033');
  });

  it('prefers the verbatim title when the query is a title and the words tie', async () => {
    mockCrossRef([
      { title: 'Is Attention All You Need?', DOI: '10.1007/978-3-031-84300-6_13', abstract: 'x'.repeat(200) },
      { title: 'Attention Is All You Need', DOI: '10.5555/3295222' },
    ]);

    expect((await searchOnlineByText('Attention Is All You Need'))?.doi).toBe('10.5555/3295222');
  });
});
