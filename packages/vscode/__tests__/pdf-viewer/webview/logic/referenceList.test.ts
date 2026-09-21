import * as fs from 'fs';
import * as path from 'path';
import {
  entryAtY,
  entryByNumber,
  findReferencesStart,
  splitReferenceEntries,
} from '../../../../src/pdf-viewer/webview/logic/referenceList';
import type { TextLine } from '../../../../src/pdf-viewer/webview/logic/textLines';

function loadFixture(name: string): TextLine[] {
  const filePath = path.join(__dirname, '../../../fixtures/references', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TextLine[];
}

function line(text: string, y = 800, extra: Partial<TextLine> = {}): TextLine {
  return { text, x: 50, xEnd: 50 + text.length * 6, y, height: 12, column: 0, ...extra };
}

describe('findReferencesStart', () => {
  it('matches a plain "References" heading', () => {
    expect(findReferencesStart([line('Introduction'), line('References'), line('[1] Smith.')])).toBe(1);
  });

  it('matches an upper-case "REFERENCES" heading', () => {
    expect(findReferencesStart([line('REFERENCES')])).toBe(0);
  });

  it('matches a numbered heading like "7. References"', () => {
    expect(findReferencesStart([line('Conclusion'), line('7. References')])).toBe(1);
  });

  it('matches "Bibliography"', () => {
    expect(findReferencesStart([line('Bibliography')])).toBe(0);
  });

  it('matches "Works Cited"', () => {
    expect(findReferencesStart([line('Works Cited')])).toBe(0);
  });

  it('rejects a long sentence that merely contains the word', () => {
    const lines = [
      line('This section references several prior results and earlier bibliography entries in detail.'),
    ];
    expect(findReferencesStart(lines)).toBe(-1);
  });

  it('returns -1 when no heading is present', () => {
    expect(findReferencesStart([line('Introduction'), line('Method'), line('Results')])).toBe(-1);
  });
});

describe('splitReferenceEntries', () => {
  it('splits bracket-numbered entries, parses their number, and joins continuations', () => {
    const lines = loadFixture('numeric-bracket.json');
    const entries = splitReferenceEntries(lines);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries[0]!.text).toBe(
      '[1] Smith, J., & Doe, A. (2019). A great paper on testing methodologies. Journal of Software, 12(3), 45-67.',
    );
  });

  it('drops junk lines that precede the first marker', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-bracket.json'));
    // The fixture's first line is a lone page number ("12") before the "[1]" marker.
    expect(entries[0]!.text.startsWith('[1]')).toBe(true);
    expect(entries.some((e) => e.text.trim() === '12')).toBe(false);
  });

  it('de-hyphenates a trailing hyphen followed by a lowercase continuation', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-bracket.json'));
    expect(entries[1]!.text).toBe(
      '[2] Lee, K. (2020). Another important contribution to the field of international research. Proceedings of XYZ, 5(1), 10-20.',
    );
  });

  it('splits dot-numbered entries and parses their number', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-dot.json'));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
  });

  it('joins a continuation line with a plain space when there is no hyphenation', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-dot.json'));
    expect(entries[0]!.text).toBe('1. Alpha, B. (2018). Foundations of testing. Computing Reviews, 4(2), 88-99.');
  });

  it('splits an unnumbered hanging-indent list on the left edge', () => {
    const entries = splitReferenceEntries(loadFixture('hanging-indent.json'));
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.number === null)).toBe(true);
    expect(entries[0]!.text).toBe('Smith, J. (2020). A study of testing. Journal of Software Engineering, 12(3), 45-67.');
    expect(entries[1]!.text).toBe(
      'Doe, A., & Lee, K. (2019). Verification techniques for large-scale systems. Proceedings of ICSE.',
    );
    expect(entries[2]!.text).toBe('Nguyen, T. (2021). A concise note on formal methods.');
  });

  it('splits a two-column numbered list in reading order, keeping each column tag', () => {
    const entries = splitReferenceEntries(loadFixture('two-column.json'));
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entries.map((e) => e.column)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('returns [] for an empty input', () => {
    expect(splitReferenceEntries([])).toEqual([]);
  });

  it('returns [] for a block with no markers and no indentation', () => {
    const lines = [line('Plain paragraph text one.'), line('Plain paragraph text two.'), line('Plain paragraph text three.')];
    expect(splitReferenceEntries(lines)).toEqual([]);
  });
});

describe('entryAtY', () => {
  const entries = splitReferenceEntries(loadFixture('two-column.json'));

  it('picks the entry whose first baseline is nearest at/below the destination y', () => {
    const entry = entryAtY(entries, { y: 706 });
    expect(entry?.number).toBe(5);
  });

  it('tolerates a destination a couple of points inside the first line', () => {
    const entry = entryAtY(entries, { y: 704 });
    expect(entry?.number).toBe(5);
  });

  it('returns null when the nearest entry is more than 4 line-heights away', () => {
    expect(entryAtY(entries, { y: 2000 })).toBeNull();
  });

  it('prefers the entry in the destination column when columnSplit and x are given', () => {
    // Without column info, entry #3 (col 0, y 740) is nearest to y=738.
    expect(entryAtY(entries, { y: 738 })?.number).toBe(3);
    // With x on the right side of the gutter, entry #4 (col 1, y 736) is preferred instead.
    expect(entryAtY(entries, { y: 738, x: 450, columnSplit: 345 })?.number).toBe(4);
  });
});

describe('entryByNumber', () => {
  const entries = splitReferenceEntries(loadFixture('two-column.json'));

  it('returns the entry with the matching number', () => {
    expect(entryByNumber(entries, 4)?.text).toContain('Davis');
  });

  it('returns null when no entry has that number', () => {
    expect(entryByNumber(entries, 99)).toBeNull();
  });
});

describe('reference list in scans and non-English papers', () => {
  const { isReferencesHeading, matchAuthorYear, splitReferenceEntries: split } =
    require('../../../../src/pdf-viewer/webview/logic/referenceList') as typeof import('../../../../src/pdf-viewer/webview/logic/referenceList');
  const ln = (text: string, y: number, x = 72) => ({ text, x, xEnd: 540, y, height: 10, column: 0 });

  it('recognises the heading across languages, accents lost to OCR, numbering and letter-spacing', () => {
    for (const h of ['REFERÊNCIAS', 'REFERENCIAS', 'Referências Bibliográficas', '7. References', 'VI REFERENCES', 'Bibliografia',
      'R E F E R E N C E S', 'Literaturverzeichnis', 'Références bibliographiques', 'References:']) {
      expect(isReferencesHeading(h)).toBe(true);
    }
    for (const h of ['References to earlier work are scarce in this field of study', 'Reference values', 'Introduction']) {
      expect(isReferencesHeading(h)).toBe(false);
    }
  });

  it('splits numbered lists whose markers OCR damaged', () => {
    const entries = split([ln('[l] A. Author. First title.', 700), ln('Journal, 2019.', 688), ln('[2) B. Writer. Second.', 670), ln('(3] C. Third. 2021.', 650)]);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries[0]!.text).toBe('[l] A. Author. First title. Journal, 2019.');
  });

  it('reads a closing bracket OCR turned into "1" only when the list\'s own numbering confirms it', () => {
    const entries = split([ln('[6] H. Edelsbrunner, A time- and space-optimal solution.', 700), ln('[71 ———, Dynamic data structures, Report 59.', 688),
      ln('Technische Universitat Graz, 1980.', 676), ln('[8] H. Edelsbrunner and J. van Leeuwen.', 664)]);
    expect(entries.map((e) => e.number)).toEqual([6, 7, 8]);
    expect(entries[1]!.text).toBe('[7] ———, Dynamic data structures, Report 59. Technische Universitat Graz, 1980.');

    // "[71" after [3] is not the next entry: it stays a continuation line of [3].
    const other = split([ln('[3] A. Author. Title.', 700), ln('[71 stray fragment', 688), ln('[4] B. Writer. Second.', 676)]);
    expect(other.map((e) => e.number)).toEqual([3, 4]);
  });

  it('splits block-style lists (ABNT: flush left, separated by vertical space)', () => {
    const entries = split([
      ln('SILVA, A. B.; COSTA, R. Título do primeiro trabalho.', 700), ln('Revista X, v. 12, n. 3, p. 45-67, 2020.', 688),
      ln('SOUZA, M. Outro trabalho relevante. São Paulo:', 664), ln('Editora Y, 2019.', 652),
      ln('TANAKA, K. Terceiro. Rio de Janeiro: Z, 2021.', 628),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[1]!.text).toBe('SOUZA, M. Outro trabalho relevante. São Paulo: Editora Y, 2019.');
  });

  it('falls back to author-like line starts when spacing is uniform', () => {
    const entries = split([
      ln('Silva, A. B. First work. Journal A, 2020.', 700), ln('Souza, M. Second work that is long enough to', 688),
      ln('wrap onto another line. Journal B, 2019.', 676), ln('Tanaka, K. Third work. Journal C, 2021.', 664),
    ]);
    expect(entries.map((e) => e.text.split(',')[0])).toEqual(['Silva', 'Souza', 'Tanaka']);
  });

  describe('matchAuthorYear', () => {
    const entries = split([
      ln('SILVA, A. B.; COSTA, R. Primeiro. Revista X, 2020.', 700),
      ln('SILVA, A. B. Segundo, sozinho. Revista Y, 2020.', 676),
      ln('SOUZA, M. Um estudo sobre Silva. Editora, 2019a.', 652),
      ln('SOUZA, M. Outro estudo. Editora, 2019b.', 628),
      ln('MÜLLER, H. Arbeit. Verlag, 2018.', 604),
    ]);

    it('matches surname in the author area plus year, ignoring case and accents', () => {
      expect(matchAuthorYear(entries, { surname: 'Muller', years: ['2018'] }).map((e) => e.text)).toEqual(['MÜLLER, H. Arbeit. Verlag, 2018.']);
    });

    it('uses co-authors to disambiguate', () => {
      const hits = matchAuthorYear(entries, { surname: 'Silva', coauthors: ['Costa'], years: ['2020'] });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.text).toContain('Primeiro');
    });

    it('returns every candidate when the citation itself is ambiguous', () => {
      expect(matchAuthorYear(entries, { surname: 'Silva', years: ['2020'] })).toHaveLength(2);
      expect(matchAuthorYear(entries, { surname: 'Souza', years: ['2019'] })).toHaveLength(2);
      expect(matchAuthorYear(entries, { surname: 'Souza', years: ['2019b'] }).map((e) => e.text)).toEqual(['SOUZA, M. Outro estudo. Editora, 2019b.']);
    });

    it('does not match a surname that only appears in a title, a wrong year, or a partial word', () => {
      expect(matchAuthorYear(entries, { surname: 'Silva', years: ['2019'] })).toEqual([]);
      expect(matchAuthorYear(entries, { surname: 'Sou', years: ['2019'] })).toEqual([]);
      expect(matchAuthorYear(entries, { surname: 'Tanaka', years: ['2020'] })).toEqual([]);
    });
  });
});
