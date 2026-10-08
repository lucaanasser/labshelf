/**
 * Tests the text-layer state list and the parser that validates stored verdicts.
 */
import { TEXT_LAYER_STATES, parseTextLayerInfo } from '@labshelf/core';

describe('TEXT_LAYER_STATES', () => {
  it('lists the states in order', () => {
    expect(TEXT_LAYER_STATES).toEqual(['native', 'ocr', 'missing', 'failed']);
  });
});

describe('parseTextLayerInfo', () => {
  it('accepts every known state and keeps only well-formed details', () => {
    expect(parseTextLayerInfo({ state: 'ocr', ocrPages: 3, failedPages: -1, reason: '', checkedAt: 't', extra: 1 }))
      .toEqual({ state: 'ocr', ocrPages: 3, checkedAt: 't' });
    expect(parseTextLayerInfo({ state: 'failed', reason: 'no canvas' })).toEqual({ state: 'failed', reason: 'no canvas', checkedAt: '' });
  });

  it('rejects values an older version or a hand edit could leave behind', () => {
    for (const value of [undefined, null, 'ocr', [], {}, { state: 'scanned' }, { state: 3 }]) {
      expect(parseTextLayerInfo(value)).toBeUndefined();
    }
  });
});
