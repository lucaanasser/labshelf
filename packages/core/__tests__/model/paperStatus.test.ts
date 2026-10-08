/**
 * Tests the paper status list and its guard.
 */
import { PAPER_STATUSES, isPaperStatus } from '@labshelf/core';

describe('paper status', () => {
  it('lists the statuses in display order', () => {
    expect(PAPER_STATUSES).toEqual(['unread', 'reading', 'done']);
  });

  it('accepts only listed statuses', () => {
    for (const status of PAPER_STATUSES) { expect(isPaperStatus(status)).toBe(true); }
    for (const value of ['Unread', '', undefined, null, 3, {}]) { expect(isPaperStatus(value)).toBe(false); }
  });
});
