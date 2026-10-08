import {
  findInTextRefs,
  floatKindOf,
  foldText,
  joinLineParts,
  refAtOffset,
  type InTextRef,
  type LinePart,
} from '../../../src/webview/logic/inTextRefs';

const at = (text: string, needle: string): InTextRef | null =>
  refAtOffset(findInTextRefs(text), text.indexOf(needle) + Math.floor(needle.length / 2));

// OCR emits one run per word: equal heights, a word-space gap between runs.
function words(text: string): LinePart[] {
  let x = 0;
  return text.split(' ').map((w) => {
    const part = { text: w, left: x, right: x + w.length * 6, height: 12 };
    x = part.right + 4;
    return part;
  });
}

describe('joinLineParts', () => {
  it('rebuilds a sentence from per-word OCR runs and reports where each run starts', () => {
    const joined = joinLineParts(words('as shown in [12, 13] before'));
    expect(joined.text).toBe('as shown in [12, 13] before');
    expect(joined.starts).toEqual([0, 3, 9, 12, 17, 21]);
  });

  it('does not insert a space where two runs touch (a born-digital run split mid-word)', () => {
    const joined = joinLineParts([
      { text: 'Fig', left: 0, right: 18, height: 12 },
      { text: 'ure 3', left: 18.4, right: 48, height: 12 },
    ]);
    expect(joined.text).toBe('Figure 3');
  });

  it('never doubles a space that a run already carries', () => {
    const joined = joinLineParts([
      { text: 'see ', left: 0, right: 24, height: 12 },
      { text: '[4]', left: 30, right: 48, height: 12 },
    ]);
    expect(joined.text).toBe('see [4]');
  });
});

describe('findInTextRefs - numeric citations', () => {
  it('finds single, list and range markers, with en dashes', () => {
    expect(at('as in [12] before', '[12]')).toMatchObject({ kind: 'numeric', numbers: [12] });
    expect(at('as in [3, 7] before', '[3, 7]')).toMatchObject({ numbers: [3, 7] });
    expect(at('as in [4–6] before', '[4–6]')).toMatchObject({ numbers: [4, 5, 6] });
    expect(at('as in [1, 3-5; 9]', '[1, 3-5; 9]')).toMatchObject({ numbers: [1, 3, 4, 5, 9] });
  });

  it('reads a marker that OCR split into separate word runs', () => {
    const joined = joinLineParts(words('results [12, 13] and'));
    const ref = refAtOffset(findInTextRefs(joined.text), joined.starts[2]! + 1); // pointer on the run "13]"
    expect(ref).toMatchObject({ kind: 'numeric', numbers: [12, 13] });
  });

  it('tolerates OCR look-alikes for 1 and 0 inside brackets', () => {
    expect(at('see [l2] here', '[l2]')).toMatchObject({ numbers: [12] });
    expect(at('see [1O] here', '[1O]')).toMatchObject({ numbers: [10] });
    expect(at('see [I] here', '[I]')).toMatchObject({ numbers: [1] });
  });

  it('ignores brackets that are not citations', () => {
    expect(findInTextRefs('a [sic] b [2020] c [] d [O] e [abc]')).toEqual([]);
  });

  it('drops descending and absurd ranges', () => {
    expect(findInTextRefs('[9-3]')).toEqual([]);
    expect(findInTextRefs('[1-400]')).toEqual([]);
  });
});

describe('findInTextRefs - author-year citations', () => {
  it('reads parenthetical citations', () => {
    expect(at('shown before (Silva, 2020).', 'Silva, 2020')).toMatchObject({ kind: 'authorYear', surname: 'Silva', years: ['2020'], coauthors: [] });
    expect(at('shown (Silva et al., 2019a).', 'Silva')).toMatchObject({ surname: 'Silva', years: ['2019a'] });
    expect(at('shown (Silva & Costa, 2021, p. 15).', 'Costa')).toMatchObject({ surname: 'Silva', coauthors: ['Costa'], years: ['2021'] });
  });

  it('separates several citations in one parenthetical and resolves the hovered one', () => {
    const text = 'as argued (Silva, 2020; Souza, 2021) elsewhere';
    expect(at(text, 'Silva, 2020')).toMatchObject({ surname: 'Silva', years: ['2020'] });
    expect(at(text, 'Souza, 2021')).toMatchObject({ surname: 'Souza', years: ['2021'] });
  });

  it('reads ABNT citations, where ";" separates the authors of one citation', () => {
    expect(at('conforme (SILVA; COSTA, 2020) indica', 'COSTA')).toMatchObject({ surname: 'SILVA', coauthors: ['COSTA'], years: ['2020'] });
    expect(at('conforme (SILVA, 2010 apud SOUZA, 2015) indica', 'SOUZA')).toMatchObject({ surname: 'SOUZA', years: ['2015'] });
  });

  it('reads narrative citations in several languages', () => {
    expect(at('Souza (2019) argues', 'Souza')).toMatchObject({ kind: 'authorYear', surname: 'Souza', years: ['2019'] });
    expect(at('Souza et al. (2019, 2021) argue', 'Souza')).toMatchObject({ surname: 'Souza', years: ['2019', '2021'] });
    expect(at('Segundo Silva e Costa (2020, p. 12), o', 'Silva')).toMatchObject({ surname: 'Silva', coauthors: ['Costa'] });
    expect(at('Silva and Costa (2020) show', 'Costa')).toMatchObject({ surname: 'Silva', coauthors: ['Costa'] });
  });

  it('does not mistake dates, floats or bare years for authors', () => {
    expect(findInTextRefs('(Received 12 March 2019)')).toEqual([]);
    expect(findInTextRefs('in that year (2020) it')).toEqual([]);
    expect(findInTextRefs('(see Figure 3, 2019 data)').filter((r) => r.kind === 'authorYear')).toEqual([]);
  });

  it('skips the capitalised non-author but keeps the real one', () => {
    expect(at('(see Figure 3 in Silva, 2020)', 'Silva')).toMatchObject({ kind: 'authorYear', surname: 'Silva' });
  });
});

describe('findInTextRefs - figures, tables and equations', () => {
  it('finds references in English and Portuguese, any case', () => {
    expect(at('as Fig. 3 shows', 'Fig. 3')).toMatchObject({ kind: 'float', floatKind: 'figure', label: '3' });
    expect(at('na figura 12a vemos', 'figura 12a')).toMatchObject({ floatKind: 'figure', label: '12a' });
    expect(at('see Table 2 for', 'Table 2')).toMatchObject({ floatKind: 'table', label: '2' });
    expect(at('ver Tabela 4 e Quadro 1', 'Quadro 1')).toMatchObject({ floatKind: 'table', label: '1' });
    expect(at('from Eq. (5) we', 'Eq. (5)')).toMatchObject({ floatKind: 'equation', label: '5' });
    expect(at('pela Equação 7 temos', 'Equação 7')).toMatchObject({ floatKind: 'equation', label: '7' });
  });

  it('reads labels numbered within a section, without swallowing the sentence\'s own full stop', () => {
    expect(at('In Fig. 1.1, an example is shown.', 'Fig. 1.1')).toMatchObject({ floatKind: 'figure', label: '1.1' });
    expect(at('given in Fig. 1.1(a).', 'Fig. 1.1')).toMatchObject({ floatKind: 'figure', label: '1.1' });
    expect(at('by Eq. (2.3b) we', 'Eq. (2.3b)')).toMatchObject({ floatKind: 'equation', label: '2.3b' });
    expect(at('as seen in Fig. 3. Next we', 'Fig. 3')).toMatchObject({ label: '3' });
  });

  it('survives OCR word splitting: "Fig." and "3" are separate runs', () => {
    const joined = joinLineParts(words('shown in Fig. 3 above'));
    expect(refAtOffset(findInTextRefs(joined.text), joined.starts[3]!)).toMatchObject({ kind: 'float', label: '3' });
  });

  it('reads "Fig." through OCR look-alikes for its i', () => {
    expect(at('shown in F1g. 3 above', 'F1g. 3')).toMatchObject({ floatKind: 'figure', label: '3' });
    expect(at('see FlG. 2.1 for', 'FlG. 2.1')).toMatchObject({ floatKind: 'figure', label: '2.1' });
  });

  it('does not fire on ordinary words that start the same way', () => {
    expect(findInTextRefs('Equipment 3 and Figaro 2 and Tabulated 4')).toEqual([]);
  });
});

describe('refAtOffset', () => {
  it('prefers the narrowest reference and returns null outside any', () => {
    const text = '(see Fig. 2 in Silva, 2020)';
    expect(at(text, 'Fig. 2')).toMatchObject({ kind: 'float' });
    expect(refAtOffset(findInTextRefs('plain text only'), 3)).toBeNull();
  });
});

describe('helpers', () => {
  it('folds case and accents', () => {
    expect(foldText('REFERÊNCIAS Bibliográficas')).toBe('referencias bibliograficas');
  });

  it('classifies float label words', () => {
    expect(floatKindOf('Tabela')).toBe('table');
    expect(floatKindOf('Quadro')).toBe('table');
    expect(floatKindOf('Eq')).toBe('equation');
    expect(floatKindOf('Gráfico')).toBe('figure');
  });
});
