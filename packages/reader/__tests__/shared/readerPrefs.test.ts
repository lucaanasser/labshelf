import { DEFAULT_READER_PREFS } from '../../src/shared/protocol';
import { normalizeReaderPrefs } from '../../src/shared/readerPrefs';

describe('normalizeReaderPrefs', () => {
  it('returns the defaults for missing input', () => {
    expect(normalizeReaderPrefs(undefined)).toEqual(DEFAULT_READER_PREFS);
    expect(normalizeReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS);
  });

  it('keeps valid values', () => {
    const prefs = { vimKeys: true, defaultZoom: 'page-fit', toolbarAutoHide: false, restorePosition: false, hoverPreviews: false, hoverDelayMs: 600, citationStyle: 'latex' };
    expect(normalizeReaderPrefs(prefs)).toEqual(prefs);
  });

  it('replaces each invalid value with its default on its own and clamps the hover delay', () => {
    const out = normalizeReaderPrefs({ vimKeys: 'yes', defaultZoom: 'huge', citationStyle: 'apa', hoverDelayMs: 99999, restorePosition: false });
    expect(out.vimKeys).toBe(DEFAULT_READER_PREFS.vimKeys);
    expect(out.defaultZoom).toBe(DEFAULT_READER_PREFS.defaultZoom);
    expect(out.citationStyle).toBe(DEFAULT_READER_PREFS.citationStyle);
    expect(out.hoverDelayMs).toBe(2000);
    expect(out.restorePosition).toBe(false);
    expect(normalizeReaderPrefs({ hoverDelayMs: -5 }).hoverDelayMs).toBe(0);
    expect(normalizeReaderPrefs({ hoverDelayMs: Number.NaN }).hoverDelayMs).toBe(DEFAULT_READER_PREFS.hoverDelayMs);
  });
});
