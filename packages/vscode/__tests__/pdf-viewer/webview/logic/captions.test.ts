import { findCaptionLines, floatRegion, pickCaption } from '../../../../src/pdf-viewer/webview/logic/captions';
import type { TextLine } from '../../../../src/pdf-viewer/webview/logic/textLines';

const W = 612;
const H = 792;
const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });
const body = (fromY: number, count: number): TextLine[] =>
  Array.from({ length: count }, (_, i) => line('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod', fromY - i * 15));

describe('findCaptionLines', () => {
  it('recognises captions by how the line starts', () => {
    const hits = findCaptionLines([
      line('Figure 3. Distribution of values', 700),
      line('FIGURA 1 – Mapa da área de estudo', 650),
      line('Table 2 Summary of the corpus', 600),
      line('Tabela 4: Resultados', 550),
      line('Fig. 12a: Detail', 500),
    ], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([
      ['figure', '3'], ['figure', '1'], ['table', '2'], ['table', '4'], ['figure', '12a'],
    ]);
  });

  it('reads labels numbered within a section', () => {
    const hits = findCaptionLines([
      line('FIG. 1.1. An example.', 700),
      line('FIG. 3.4. The partitions of vertical segments given in Fig. 1.1(a).', 650),
      line('x = y + z (2.3)', 600, { x: 250, xEnd: 538 }),
    ], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([['figure', '1.1'], ['figure', '3.4'], ['equation', '2.3']]);
  });

  it('reads a small-caps "FIG." that OCR garbled', () => {
    const hits = findCaptionLines([line('F1G. 2.2. The procedure BFS.', 700), line('Fi1G. 4.1. The procedure COMPUTE_DFMIN.', 650), line('FlG. 3: Detail', 600)], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([['figure', '2.2'], ['figure', '4.1'], ['figure', '3']]);
  });

  it('ignores a sentence that merely starts a line with the label', () => {
    expect(findCaptionLines([line('Figure 3 shows that the effect', 700), line('Table 2 lists every', 680)], W, null)).toEqual([]);
  });

  it('finds display equations by their number at the right margin', () => {
    const hits = findCaptionLines([
      line('E = mc2 (5)', 700, { x: 250, xEnd: 538 }),
      line('as discussed by the committee in its report of that year (5)', 650, { xEnd: 380 }),
    ], W, null);
    expect(hits).toEqual([{ kind: 'equation', label: '5', lineIndex: 0 }]);
  });
});

describe('floatRegion', () => {
  it('takes the text-free band above a caption that sits below its figure', () => {
    const lines = [...body(760, 6), line('Figure 1: A figure standing above its caption.', 430), ...body(400, 10)];
    const hit = { kind: 'figure' as const, label: '1', lineIndex: 6 };
    const region = floatRegion(lines, hit, W, H, null);
    // from just under the caption up to the last body line above the figure (y 685)
    expect(region.yBottom).toBeLessThan(430);
    expect(region.yTop).toBeGreaterThan(640);
    expect(region.yTop).toBeLessThanOrEqual(685 + 1);
    expect([region.x0, region.x1]).toEqual([0, W]);
  });

  it('takes the band below when the caption sits above its figure (ABNT)', () => {
    const lines = [...body(760, 6), line('Figura 2 – Titulo acima da figura', 670), ...body(400, 10)];
    const region = floatRegion(lines, { kind: 'figure', label: '2', lineIndex: 6 }, W, H, null);
    expect(region.yTop).toBeGreaterThanOrEqual(670);
    expect(region.yBottom).toBeLessThan(450);
    expect(region.yBottom).toBeGreaterThanOrEqual(400);
  });

  it('does not let axis labels OCR found inside the figure end the band', () => {
    const lines = [
      ...body(760, 4),
      line('0.5', 600, { x: 100, xEnd: 118 }),
      line('Time (s)', 480, { x: 280, xEnd: 330 }),
      line('Figure 1: caption below the plot', 430),
      ...body(400, 8),
    ];
    const region = floatRegion(lines, { kind: 'figure', label: '1', lineIndex: 6 }, W, H, null);
    expect(region.yTop).toBeGreaterThan(640);
  });

  it('always looks below a table caption', () => {
    const lines = [...body(760, 3), line('Table 1. Results', 700), line('a  1  2  3', 680), line('b  4  5  6', 665)];
    const region = floatRegion(lines, { kind: 'table', label: '1', lineIndex: 3 }, W, H, null);
    expect(region.yTop).toBeGreaterThanOrEqual(700);
    expect(region.yBottom).toBeLessThan(665);
  });

  it('ends a table at the first clear break instead of showing the void under it', () => {
    const rows = [line('Table 1. Results', 700), line('Group  Mean  SD', 682), line('A  12.4  1.2', 666), line('B  15.8  2.1', 650)];
    // table at the foot of the page: nothing below the last row
    const alone = floatRegion(rows, { kind: 'table', label: '1', lineIndex: 0 }, W, H, null);
    expect(alone.yBottom).toBeLessThan(650);
    expect(alone.yBottom).toBeGreaterThan(615);
    // table followed, after a gap, by the next paragraph: the paragraph is left out
    const followed = floatRegion([...rows, ...body(590, 6)], { kind: 'table', label: '1', lineIndex: 0 }, W, H, null);
    expect(followed.yBottom).toBeLessThan(650);
    expect(followed.yBottom).toBeGreaterThan(600);
  });

  it('keeps the fixed band under a table caption when OCR recognised nothing in the table', () => {
    const region = floatRegion([line('Tabela 3 – Imagem', 700)], { kind: 'table', label: '3', lineIndex: 0 }, W, H, null);
    expect(region.yBottom).toBeCloseTo(700 + 11 - H * 0.4, 0);
  });

  it('crops to the caption\'s column on a two-column page and spans both when the caption straddles the gutter', () => {
    const left = line('Figure 1. In the left column', 430, { x: 50, xEnd: 290 });
    const wide = line('Figure 2. Across both columns of the page', 430, { x: 120, xEnd: 500 });
    expect(floatRegion([left], { kind: 'figure', label: '1', lineIndex: 0 }, W, H, 306)).toMatchObject({ x0: 0, x1: 306 });
    expect(floatRegion([wide], { kind: 'figure', label: '2', lineIndex: 0 }, W, H, 306)).toMatchObject({ x0: 0, x1: W });
  });

  it('shows a symmetric band when no clear float neighbours the caption', () => {
    const lines = [...body(760, 20), line('Figure 9. Squeezed between paragraphs', 445), ...body(430, 20)];
    const region = floatRegion(lines, { kind: 'figure', label: '9', lineIndex: 20 }, W, H, null);
    expect(region.yTop - region.yBottom).toBeGreaterThan(H * 0.3);
    expect(region.yTop).toBeGreaterThan(445);
    expect(region.yBottom).toBeLessThan(445);
  });

  it('pads a band around an equation and stays inside the page', () => {
    const region = floatRegion([line('x = y (1)', 20, { x: 250, xEnd: 538 })], { kind: 'equation', label: '1', lineIndex: 0 }, W, H, null);
    expect(region.yBottom).toBe(0);
    expect(region.yTop).toBeGreaterThan(31);
  });
});

describe('pickCaption', () => {
  const hits = [{ kind: 'figure' as const, label: '3' }, { kind: 'table' as const, label: '3' }, { kind: 'figure' as const, label: '4a' }];

  it('matches kind and label, falling back to the label without its sub-figure letter', () => {
    expect(pickCaption(hits, 'table', '3')).toBe(1);
    expect(pickCaption(hits, 'figure', '3b')).toBe(0);
    expect(pickCaption(hits, 'figure', '4')).toBe(2);
    expect(pickCaption(hits, 'equation', '3')).toBe(-1);
  });
});
