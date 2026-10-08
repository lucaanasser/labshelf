import {
  FIND_ORIGIN_TTL_MS,
  FIND_OVERLAY_PX,
  decideMatchScroll,
  freshOrigin,
} from '../../../src/webview/logic/findScroll';

describe('findScroll', () => {
  describe('decideMatchScroll', () => {
    const viewH = 900;

    it('stays put when the hit was already in the reading zone', () => {
      expect(decideMatchScroll({ top: 400, bottom: 420 }, viewH)).toEqual({ kind: 'stay' });
      expect(decideMatchScroll({ top: FIND_OVERLAY_PX, bottom: FIND_OVERLAY_PX + 20 }, viewH)).toEqual({ kind: 'stay' });
    });

    it('re-places a hit hidden under the overlay toolbar and find bar', () => {
      const decision = decideMatchScroll({ top: 50, bottom: 70 }, viewH);
      expect(decision).toEqual({ kind: 'place', top: 270 });
    });

    it('re-places a hit above, below or too close to the bottom edge of the view', () => {
      expect(decideMatchScroll({ top: -300, bottom: -280 }, viewH).kind).toBe('place');
      expect(decideMatchScroll({ top: 1500, bottom: 1520 }, viewH).kind).toBe('place');
      expect(decideMatchScroll({ top: 860, bottom: 880 }, viewH).kind).toBe('place');
    });

    it('places at 30% of the view, but never under the overlay in a short panel', () => {
      expect(decideMatchScroll(null, 1000)).toEqual({ kind: 'place', top: 300 });
      expect(decideMatchScroll(null, 200)).toEqual({ kind: 'place', top: FIND_OVERLAY_PX });
    });

    it('never stays without a known starting position', () => {
      expect(decideMatchScroll(null, viewH).kind).toBe('place');
    });
  });

  describe('freshOrigin', () => {
    const origin = { top: 1200, left: 0, at: 10_000 };

    it('keeps an origin recorded moments ago', () => {
      expect(freshOrigin(origin, 10_000)).toBe(origin);
      expect(freshOrigin(origin, 10_000 + FIND_ORIGIN_TTL_MS)).toBe(origin);
    });

    it('drops a stale origin so a late text-layer render cannot yank the reader back', () => {
      expect(freshOrigin(origin, 10_001 + FIND_ORIGIN_TTL_MS)).toBeNull();
    });

    it('passes null through', () => {
      expect(freshOrigin(null, 5)).toBeNull();
    });
  });
});
