import { detectColumns, groupItemsIntoLines, readableItems, runOrientation, type TextItemBox } from '../../../src/webview/logic/textLines';

function item(str: string, x: number, y: number, width: number, height = 10): TextItemBox {
  return { str, x, y, width, height };
}

describe('groupItemsIntoLines', () => {
  it('groups items that share a baseline into one line, sorted by x regardless of input order', () => {
    // A single short line with too few items to trigger two-column detection.
    const hello = item('Hello', 0, 700, 40);
    const world = item('World', 50, 700, 40); // gap of 10 from `hello`'s end (40): needs a space
    const bang = item('!', 90, 700, 5); // touches `world`'s end (90): no extra space

    const lines = groupItemsIntoLines([bang, hello, world], 600);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Hello World!');
    expect(lines[0]!.x).toBe(0); // leftmost item after sorting
    expect(lines[0]!.xEnd).toBe(95); // rightmost item's x + width after sorting
  });

  it('inserts a space only across a real gap, not between touching items', () => {
    const a = item('foo', 0, 700, 30);
    const bTouching = item('bar', 30, 700, 30); // no gap at all
    const cGap = item('baz', 90, 700, 30); // 30px gap from bTouching's end (60)

    const lines = groupItemsIntoLines([a, bTouching, cGap], 600);
    expect(lines[0]!.text).toBe('foobar baz');
  });

  it('orders lines top-to-bottom (PDF y descending), regardless of input order', () => {
    const top = item('Top', 0, 700, 20);
    const middle = item('Middle', 0, 650, 30);
    const bottom = item('Bottom', 0, 600, 30);

    const lines = groupItemsIntoLines([middle, bottom, top], 600);
    expect(lines.map((l) => l.text)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(lines.map((l) => l.y)).toEqual([700, 650, 600]);
  });
});

/** Builds `count` synthetic word-like items in one visual column, two rows (two lines). */
function columnItems(startX: number, spacing: number, count: number, yTop: number, yBottom: number): TextItemBox[] {
  const perLine = count / 2;
  const items: TextItemBox[] = [];
  for (let i = 0; i < count; i++) {
    const line = i < perLine ? 0 : 1;
    const col = i % perLine;
    items.push(item(`w${i}`, startX + col * spacing, line === 0 ? yTop : yBottom, spacing - 2));
  }
  return items;
}

describe('detectColumns', () => {
  it('returns null when there are too few items', () => {
    const items = [item('a', 0, 700, 10), item('b', 300, 700, 10), item('c', 550, 700, 10)];
    expect(detectColumns(items, 600)).toBeNull();
  });

  it('returns null for a single justified column spanning the full width', () => {
    // Simulate a normal paragraph: overlapping items spread across the whole width,
    // including the middle of the page, so there is no empty gutter to find.
    const items: TextItemBox[] = [];
    for (let i = 0; i < 40; i++) {
      items.push(item(`w${i}`, (i * 17) % 560, 700 - Math.floor(i / 10) * 12, 25));
    }
    expect(detectColumns(items, 600)).toBeNull();
  });

  it('returns null when the mass on the two sides of a gap is too lopsided', () => {
    // A wide left column (25 items) plus a tiny 3-item cluster on the right: there is a
    // clear gap, but the right side is not a real second column.
    const left = columnItems(0, 10, 24, 700, 650); // x in [0, 230]
    const right = columnItems(400, 10, 4, 700, 650); // x in [400, 405]
    expect(detectColumns([...left, ...right], 600)).toBeNull();
  });

  it('finds an x near the gutter for a genuine two-column page', () => {
    const left = columnItems(0, 10, 24, 700, 650); // x in [0, 230]
    const right = columnItems(400, 10, 24, 700, 650); // x in [400, 630]
    const split = detectColumns([...left, ...right], 800);
    expect(split).not.toBeNull();
    expect(split as number).toBeGreaterThan(230);
    expect(split as number).toBeLessThan(400);
  });
});

describe('groupItemsIntoLines with two columns', () => {
  it('reads the whole left column top-to-bottom, then the whole right column, tagging `column`', () => {
    const pageWidth = 600;
    const spacing = 12;
    const wordWidth = 10;

    function row(startX: number, y: number, prefix: string, count: number): TextItemBox[] {
      return Array.from({ length: count }, (_, i) => item(`${prefix}${i}`, startX + i * spacing, y, wordWidth));
    }

    // Left column: x in [0, 118]. Right column: x in [380, 498]. Gutter is comfortably empty.
    const leftLine1 = row(0, 700, 'L1w', 10);
    const leftLine2 = row(0, 650, 'L2w', 10);
    // The right column's first line is visually *above* the left column's lines, to prove
    // that reading order is column-major, not a global sort by y.
    const rightLine1 = row(380, 750, 'R1w', 10);
    const rightLine2 = row(380, 680, 'R2w', 10);

    const shuffled = [...rightLine2, ...leftLine2, ...rightLine1, ...leftLine1];
    const lines = groupItemsIntoLines(shuffled, pageWidth);

    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.column)).toEqual([0, 0, 1, 1]);
    // Left column lines come first, top-to-bottom, even though the right column has a higher y.
    expect(lines[0]!.y).toBe(700);
    expect(lines[1]!.y).toBe(650);
    expect(lines[2]!.y).toBe(750);
    expect(lines[3]!.y).toBe(680);
    expect(lines[0]!.text.startsWith('L1w0')).toBe(true);
    expect(lines[2]!.text.startsWith('R1w0')).toBe(true);
  });
});

describe('runOrientation', () => {
  it('reads the quarter turn from the pdf.js transform', () => {
    expect(runOrientation([10, 0, 0, 10, 56, 700])).toBe(0);
    // Slight skew of a scan is still upright.
    expect(runOrientation([6.24, -0.02, 0.02, 5.83, 56, 670])).toBe(0);
    expect(runOrientation([0, 9.97, -9.97, 0, 10, 84])).toBe(1);
    expect(runOrientation([-10, 0, 0, -10, 300, 400])).toBe(2);
    expect(runOrientation([0, -10, 10, 0, 600, 700])).toBe(3);
  });
});

describe('readableItems', () => {
  /** A page of `rows` body lines starting at x=56, one OCR run per word. */
  function bodyPage(rows: number): TextItemBox[] {
    const items: TextItemBox[] = [];
    for (let r = 0; r < rows; r++) {
      for (let w = 0; w < 8; w++) { items.push(item(`word${r}x${w}`, 56 + w * 46, 640 - r * 12, 40, 9)); }
    }
    return items;
  }
  const stamp: TextItemBox = { ...item('Downloaded 12/25/12 to 150.135.135.70. Redistribution subject to license', 10, 84, 552, 10), orientation: 1 };

  it('drops a stamp set sideways up the margin, which would otherwise swallow the line at its y', () => {
    const page = [...bodyPage(6), item('[18]', 56, 87, 16, 8), item('McCreight,', 78, 87, 50, 8), stamp];
    const kept = readableItems(page, 486);
    expect(kept).not.toContain(stamp);
    const last = groupItemsIntoLines(kept, 486).at(-1)!;
    expect(last.text).toBe('[18] McCreight,');
  });

  it('drops the short tokens OCR strands in the outer margin, so line-anchored tests see the real line start', () => {
    const debris = [item('&', 5, 432, 6, 7), item('5', 5, 416, 5, 7), item('[=', 6, 404, 8, 8), item('ES', 2, 392, 9, 9)];
    const page = [...bodyPage(6), ...debris, item('REFERENCES', 215, 432, 60, 7), item('[1]', 61, 416, 12, 7), item('Author,', 78, 416, 40, 7)];
    const kept = readableItems(page, 486);
    for (const d of debris) { expect(kept).not.toContain(d); }
    const texts = groupItemsIntoLines(kept, 486).map((l) => l.text);
    expect(texts).toContain('REFERENCES');
    expect(texts).toContain('[1] Author,');
  });

  it('keeps hanging list and reference markers even when the text block starts well to their right', () => {
    const items: TextItemBox[] = [];
    for (let r = 0; r < 9; r++) {
      items.push(item(`${r + 1}.`, 72, 700 - r * 24, 8, 10));
      for (let w = 0; w < 4; w++) { items.push(item(`entry${r}w${w}`, 108 + w * 60, 700 - r * 24, 52, 10)); }
    }
    expect(readableItems(items, 612)).toHaveLength(items.length);
  });

  it('keeps the text of a page drawn entirely sideways, and everything when there is too little text to find margins', () => {
    const sideways = bodyPage(4).map((it) => ({ ...it, orientation: 1 }));
    expect(readableItems(sideways, 486)).toHaveLength(sideways.length);
    const sparse = [item('&', 5, 432, 6, 7), item('REFERENCES', 215, 432, 60, 7)];
    expect(readableItems(sparse, 486)).toEqual(sparse);
  });
});
