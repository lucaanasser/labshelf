import {
  activeOutlineIndex,
  flattenOutline,
  visibleRows,
  type RawOutlineNode,
} from '../../../src/webview/logic/outlineModel';

describe('flattenOutline', () => {
  it('lists items in document order with depth, parentId and hasChildren', () => {
    const tree: RawOutlineNode[] = [
      {
        title: 'A',
        items: [
          { title: 'A1' },
          { title: 'A2', items: [{ title: 'A2a' }] },
        ],
      },
      { title: 'B' },
    ];

    const rows = flattenOutline(tree);
    expect(rows.map((r) => r.title)).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 0]);

    const [a, a1, a2, a2a, b] = rows;
    expect(a!.parentId).toBeNull();
    expect(a1!.parentId).toBe(a!.id);
    expect(a2!.parentId).toBe(a!.id);
    expect(a2a!.parentId).toBe(a2!.id);
    expect(b!.parentId).toBeNull();

    expect(a!.hasChildren).toBe(true);
    expect(a1!.hasChildren).toBe(false);
    expect(a2!.hasChildren).toBe(true);
    expect(a2a!.hasChildren).toBe(false);
    expect(b!.hasChildren).toBe(false);
  });

  it('normalises whitespace in titles', () => {
    const rows = flattenOutline([{ title: '  Foo\n\tBar   Baz  ' }]);
    expect(rows[0]!.title).toBe('Foo Bar Baz');
  });

  it('falls back to "Untitled" for a blank or missing title', () => {
    const rows = flattenOutline([
      { title: '' },
      { title: '   \n  ' },
      { title: undefined as unknown as string },
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Untitled', 'Untitled', 'Untitled']);
  });

  it('returns an empty array for null or undefined input', () => {
    expect(flattenOutline(null)).toEqual([]);
    expect(flattenOutline(undefined)).toEqual([]);
  });

  it('stops descending beyond the depth cap', () => {
    // Build a 14-level-deep chain of single-child nodes.
    let leaf: RawOutlineNode = { title: 'L13' };
    for (let level = 12; level >= 0; level--) {
      leaf = { title: `L${level}`, items: [leaf] };
    }

    const rows = flattenOutline([leaf]);
    // Only depths 0..11 (12 levels) are emitted; deeper nodes are dropped.
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.title)).toEqual(Array.from({ length: 12 }, (_, i) => `L${i}`));
    // The last emitted row's own children were cut off, even though the source node had one.
    expect(rows[11]!.hasChildren).toBe(false);
  });
});

describe('visibleRows', () => {
  const tree: RawOutlineNode[] = [
    {
      title: 'A',
      items: [
        { title: 'A1' },
        { title: 'A2', items: [{ title: 'A2a' }] },
      ],
    },
    { title: 'B' },
  ];
  const rows = flattenOutline(tree);
  const idOf = (title: string): number => rows.find((r) => r.title === title)!.id;

  it('hides all descendants of a collapsed node, including grandchildren, but keeps siblings', () => {
    const collapsed = new Set([idOf('A2')]);
    const visible = visibleRows(rows, collapsed).map((r) => r.title);

    expect(visible).toEqual(['A', 'A1', 'A2', 'B']);
    expect(visible).not.toContain('A2a');
  });

  it('shows every row when nothing is collapsed', () => {
    expect(visibleRows(rows, new Set()).map((r) => r.title)).toEqual(['A', 'A1', 'A2', 'A2a', 'B']);
  });
});

describe('activeOutlineIndex', () => {
  it('returns the last entry starting at or before the current page', () => {
    expect(activeOutlineIndex([1, 5, 10], 7)).toBe(1);
  });

  it('ignores null pages', () => {
    expect(activeOutlineIndex([null, 2, null], 5)).toBe(1);
  });

  it('returns -1 when no entry qualifies', () => {
    expect(activeOutlineIndex([10, 20], 1)).toBe(-1);
    expect(activeOutlineIndex([null, null], 5)).toBe(-1);
  });

  it('prefers the later row on a tie', () => {
    expect(activeOutlineIndex([1, null, 3, 3, 5], 4)).toBe(3);
  });
});
