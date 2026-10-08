/**
 * Unit tests for the normalization applied after merging registry records:
 * volume and pages must read the way a citation prints them, whichever
 * registry happened to supply them.
 */
import { mergeMetadata, tidyCitationFields } from '@labshelf/core';

describe('tidyCitationFields', () => {
  it('drops an issue number glued onto the volume', () => {
    expect(tidyCitationFields({ volume: '25 3', issue: '3' })).toMatchObject({ volume: '25', issue: '3' });
  });

  it('splits volume and issue when only the glued form is known', () => {
    expect(tidyCitationFields({ volume: '25 3' })).toMatchObject({ volume: '25', issue: '3' });
    expect(tidyCitationFields({ volume: '12 (4)' })).toMatchObject({ volume: '12', issue: '4' });
  });

  it('expands MEDLINE-abbreviated page ranges and leaves the rest alone', () => {
    expect(tidyCitationFields({ pages: '111-9' }).pages).toBe('111-119');
    expect(tidyCitationFields({ pages: '1023-31' }).pages).toBe('1023-1031');
    expect(tidyCitationFields({ pages: '478-494' }).pages).toBe('478-494');
    expect(tidyCitationFields({ pages: 'e0185809' }).pages).toBe('e0185809');
    expect(tidyCitationFields({ pages: '5998–6008' }).pages).toBe('5998-6008');
  });

  it('is applied to every merged record', () => {
    const merged = mergeMetadata([{ name: 'semanticscholar', trust: 1, metadata: { title: 'T', volume: '25 3', issue: '3', pages: '111-9' } }]);
    expect(merged.metadata).toMatchObject({ volume: '25', issue: '3', pages: '111-119' });
  });
});
