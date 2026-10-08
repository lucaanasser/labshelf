import {
  CROSS_SOURCE_WINDOW_MS,
  isDuplicateDelivery,
  type ActionStamp,
} from '../../../src/webview/logic/actionDedupe';

const stamp = (action: string, source: 'key' | 'host', at: number): ActionStamp => ({ action, source, at });

describe('actionDedupe', () => {
  it('runs the first delivery', () => {
    expect(isDuplicateDelivery(null, stamp('zoomIn', 'key', 0))).toBe(false);
  });

  it('drops the same chord arriving through the other route shortly after', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'host', 1030))).toBe(true);
    expect(isDuplicateDelivery(stamp('find', 'host', 1000), stamp('find', 'key', 1005))).toBe(true);
  });

  it('keeps repeats from the same source, so a held key still repeats', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'key', 1030))).toBe(false);
    expect(isDuplicateDelivery(stamp('zoomIn', 'host', 1000), stamp('zoomIn', 'host', 1030))).toBe(false);
  });

  it('keeps a different action from the other route', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomOut', 'host', 1010))).toBe(false);
  });

  it('keeps the other route once the window has passed', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'host', 1000 + CROSS_SOURCE_WINDOW_MS))).toBe(false);
  });

  it('handles a held chord delivered through both routes: one action per key event', () => {
    // Key events every 40 ms, each echoed by the host 25 ms later.
    let last: ActionStamp | null = null;
    let ran = 0;
    const deliver = (s: ActionStamp): void => {
      if (isDuplicateDelivery(last, s)) { return; }
      last = s;
      ran++;
    };
    for (let i = 0; i < 5; i++) {
      deliver(stamp('zoomIn', 'key', i * 40));
      deliver(stamp('zoomIn', 'host', i * 40 + 25));
    }
    expect(ran).toBe(5);
  });
});
