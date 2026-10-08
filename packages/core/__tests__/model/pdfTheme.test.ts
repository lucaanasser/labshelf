/**
 * Tests the reader theme list and its guard.
 */
import { PDF_THEMES, isPdfTheme } from '@labshelf/core';

describe('pdf theme', () => {
  it('lists the themes in picker order', () => {
    expect(PDF_THEMES).toEqual(['auto', 'light', 'dark', 'sepia', 'high-contrast']);
  });

  it('accepts only listed themes', () => {
    for (const theme of PDF_THEMES) { expect(isPdfTheme(theme)).toBe(true); }
    for (const value of ['Dark', '', undefined, null, 1]) { expect(isPdfTheme(value)).toBe(false); }
  });
});
