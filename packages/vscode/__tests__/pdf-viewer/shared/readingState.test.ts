import { clampPage, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeReadingState } from '../../../src/pdf-viewer/shared/readingState';

describe('normalizeReadingState', () => {
  it('accepts a valid state with a preset scaleValue', () => {
    const raw = { page: 3, scaleValue: 'page-width', updatedAt: '2024-01-01T00:00:00.000Z' };
    expect(normalizeReadingState(raw)).toEqual(raw);
  });

  it('accepts a valid state with a numeric scaleValue', () => {
    const raw = { page: 1, scaleValue: '1.5', updatedAt: '2024-01-01T00:00:00.000Z' };
    expect(normalizeReadingState(raw)).toEqual(raw);
  });

  it('floors a fractional page', () => {
    const out = normalizeReadingState({ page: 2.9, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' });
    expect(out?.page).toBe(2);
  });

  it('rejects a page below 1', () => {
    expect(normalizeReadingState({ page: 0, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
    expect(normalizeReadingState({ page: -3, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
  });

  it('rejects a non-finite or missing page', () => {
    expect(normalizeReadingState({ page: NaN, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
    expect(normalizeReadingState({ page: Infinity, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
    expect(normalizeReadingState({ scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
  });

  it('rejects a missing scaleValue', () => {
    expect(normalizeReadingState({ page: 1, updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
  });

  it('rejects a scale value that is too large ("huge")', () => {
    expect(normalizeReadingState({ page: 1, scaleValue: '100', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
  });

  it('rejects a scale value of "0"', () => {
    expect(normalizeReadingState({ page: 1, scaleValue: '0', updatedAt: '2024-01-01T00:00:00.000Z' })).toBeUndefined();
  });

  it('rejects an array', () => {
    expect(normalizeReadingState([])).toBeUndefined();
  });

  it('rejects null', () => {
    expect(normalizeReadingState(null)).toBeUndefined();
  });

  it('keeps optional left/top only when they are finite numbers', () => {
    const withOffsets = normalizeReadingState({
      page: 1, scaleValue: '1', left: 10.5, top: -3, updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(withOffsets?.left).toBe(10.5);
    expect(withOffsets?.top).toBe(-3);

    const withBadOffsets = normalizeReadingState({
      page: 1, scaleValue: '1', left: '10', updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(withBadOffsets?.left).toBeUndefined();
  });

  describe('sidebar', () => {
    it('requires a boolean open and a valid tab', () => {
      const valid = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: true, tab: 'outline' },
      });
      expect(valid?.sidebar).toEqual({ open: true, tab: 'outline' });

      const badOpen = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: 'yes', tab: 'outline' },
      });
      expect(badOpen?.sidebar).toBeUndefined();

      const badTab = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: true, tab: 'bogus' },
      });
      expect(badTab?.sidebar).toBeUndefined();

      const notAnObject = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: 'nope',
      });
      expect(notAnObject?.sidebar).toBeUndefined();
    });

    it('clamps width to [160, 480]', () => {
      const tooWide = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: true, tab: 'outline', width: 1000 },
      });
      expect(tooWide?.sidebar?.width).toBe(MAX_SIDEBAR_WIDTH);

      const tooNarrow = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: true, tab: 'outline', width: 10 },
      });
      expect(tooNarrow?.sidebar?.width).toBe(MIN_SIDEBAR_WIDTH);

      const inRange = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: true, tab: 'outline', width: 300.4 },
      });
      expect(inRange?.sidebar?.width).toBe(300);
    });

    it('omits width when not provided', () => {
      const out = normalizeReadingState({
        page: 1, scaleValue: '1', updatedAt: '2024-01-01T00:00:00.000Z',
        sidebar: { open: false, tab: 'thumbnails' },
      });
      expect(out?.sidebar?.width).toBeUndefined();
    });
  });

  it('falls back to an ISO timestamp when updatedAt is missing', () => {
    const out = normalizeReadingState({ page: 1, scaleValue: '1' });
    expect(out?.updatedAt).toBe(new Date(0).toISOString());
  });
});

describe('clampPage', () => {
  it('leaves an in-range page untouched', () => {
    expect(clampPage(5, 10)).toBe(5);
  });

  it('clamps below 1 up to 1', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-5, 10)).toBe(1);
  });

  it('clamps above totalPages down to totalPages', () => {
    expect(clampPage(15, 10)).toBe(10);
  });

  it('floors a fractional page', () => {
    expect(clampPage(5.9, 10)).toBe(5);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(clampPage(NaN, 10)).toBe(1);
    expect(clampPage(Infinity, 10)).toBe(1);
  });

  it('never returns less than 1, even when totalPages is 0', () => {
    expect(clampPage(5, 0)).toBe(1);
  });
});
