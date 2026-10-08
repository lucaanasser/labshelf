import { authorYearLabel, cleanQuote, formatQuoteWithCitation, type CitablePaper } from '../../src/reader/citationFormat';

function paper(overrides: Partial<CitablePaper> = {}): CitablePaper {
  return { citeKey: 'nasser2024', title: 'A Great Paper', authors: ['Luca Nasser'], year: 2024, ...overrides };
}

/** Builds a CitablePaper with no `year` key at all (rather than `year: undefined`). */
function paperWithoutYear(overrides: Partial<Omit<CitablePaper, 'year'>> = {}): CitablePaper {
  return { citeKey: 'nasser2024', title: 'A Great Paper', authors: ['Luca Nasser'], ...overrides };
}

describe('cleanQuote', () => {
  it('collapses newlines and repeated whitespace into single spaces', () => {
    expect(cleanQuote('The   quick\n\tbrown\nfox')).toBe('The quick brown fox');
  });

  it('joins a hyphenated line break, e.g. "inter-\\nnational" -> "international"', () => {
    expect(cleanQuote('inter-\nnational')).toBe('international');
  });

  it('keeps a real hyphen when the continuation starts with an uppercase letter', () => {
    expect(cleanQuote('non-\nEuropean countries')).toBe('non- European countries');
  });
});

describe('authorYearLabel', () => {
  it('falls back to the citeKey when there are no authors', () => {
    expect(authorYearLabel(paperWithoutYear({ authors: [] }))).toBe('nasser2024');
  });

  it('uses the surname of a single author', () => {
    expect(authorYearLabel(paper({ authors: ['Ada Lovelace'], year: 1843 }))).toBe('Lovelace, 1843');
  });

  it('joins two authors with "&"', () => {
    expect(authorYearLabel(paper({ authors: ['Ada Lovelace', 'Charles Babbage'], year: 1843 }))).toBe('Lovelace & Babbage, 1843');
  });

  it('uses "et al." for three or more authors', () => {
    expect(authorYearLabel(paper({ authors: ['Ada Lovelace', 'Charles Babbage', 'Alan Turing'], year: 1950 }))).toBe(
      'Lovelace et al., 1950',
    );
  });

  it('extracts the surname from a "Last, First" formatted author', () => {
    expect(authorYearLabel(paper({ authors: ['Nasser, Luca'], year: 2024 }))).toBe('Nasser, 2024');
  });

  it('omits the year when it is missing', () => {
    expect(authorYearLabel(paperWithoutYear({ authors: ['Ada Lovelace'] }))).toBe('Lovelace');
  });
});

describe('formatQuoteWithCitation', () => {
  const quote = 'a bold claim';
  const p = paper();

  it('formats the pandoc style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'pandoc')).toBe('> a bold claim\n\n[@nasser2024, p. 12]');
  });

  it('formats the latex style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'latex')).toBe("``a bold claim'' \\cite[p.~12]{nasser2024}");
  });

  it('formats the author-year style', () => {
    expect(formatQuoteWithCitation(quote, p, 12, 'author-year')).toBe('"a bold claim" (Nasser, 2024, p. 12)');
  });

  it('formats the citekey style: the bare key, deliberately without a page', () => {
    // The minimal style for quick notes; the three richer styles are the ones that carry "p. N".
    expect(formatQuoteWithCitation(quote, p, 12, 'citekey')).toBe('a bold claim @nasser2024');
  });

  it('cleans the quote before formatting (collapses whitespace, de-hyphenates)', () => {
    const messy = 'a bold\nclaim';
    expect(formatQuoteWithCitation(messy, p, 1, 'pandoc')).toBe('> a bold claim\n\n[@nasser2024, p. 1]');
  });
});
