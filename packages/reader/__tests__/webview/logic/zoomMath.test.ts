import {
  anchorOrigin,
  boundedFactor,
  clampScale,
  formatZoomLabel,
  isPresetScale,
  MAX_SCALE,
  MIN_SCALE,
  nextZoomStep,
  wheelToScaleFactor,
} from '../../../src/webview/logic/zoomMath';

describe('clampScale', () => {
  it('clamps below the minimum and above the maximum', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(10)).toBe(MAX_SCALE);
  });

  it('leaves an in-range value untouched', () => {
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(1);
    expect(clampScale(-Infinity)).toBe(1);
  });
});

describe('isPresetScale', () => {
  it('accepts every pdf.js preset value', () => {
    expect(isPresetScale('page-width')).toBe(true);
    expect(isPresetScale('page-fit')).toBe(true);
    expect(isPresetScale('page-actual')).toBe(true);
    expect(isPresetScale('auto')).toBe(true);
  });

  it('rejects a numeric scale string and nullish values', () => {
    expect(isPresetScale('1.5')).toBe(false);
    expect(isPresetScale(null)).toBe(false);
    expect(isPresetScale(undefined)).toBe(false);
  });
});

describe('nextZoomStep', () => {
  it('finds the neighbouring step from an in-between value', () => {
    expect(nextZoomStep(0.6, 1)).toBe(0.67);
    expect(nextZoomStep(0.6, -1)).toBe(0.5);
  });

  it('finds the neighbouring step from a value that is exactly on the ladder', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1);
    expect(nextZoomStep(1, -1)).toBe(0.9);
  });

  it('clamps at both ends of the ladder', () => {
    expect(nextZoomStep(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(nextZoomStep(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });
});

describe('wheelToScaleFactor', () => {
  it('returns 1 for a zero or non-finite delta', () => {
    expect(wheelToScaleFactor(0, 0)).toBe(1);
    expect(wheelToScaleFactor(NaN, 0)).toBe(1);
  });

  it('maps small pixel deltas smoothly and symmetrically', () => {
    const down = wheelToScaleFactor(10, 0);
    const up = wheelToScaleFactor(-10, 0);
    expect(down).toBeLessThan(1);
    expect(up).toBeGreaterThan(1);
    // exp(-x) and exp(x) are reciprocals, so the pair roughly cancels out.
    expect(down * up).toBeCloseTo(1, 5);
  });

  it('maps a big pixel delta (>= 50) to a 1.1x notch', () => {
    const factor = wheelToScaleFactor(100, 0);
    expect(factor).toBeCloseTo(1 / 1.1, 5);
  });

  it('maps line-mode deltas to 1.1x notches regardless of magnitude', () => {
    expect(wheelToScaleFactor(3, 1)).toBeCloseTo(1 / 1.1, 5);
    expect(wheelToScaleFactor(-3, 1)).toBeCloseTo(1.1, 5);
  });

  it('always returns a factor within [0.5, 2]', () => {
    expect(wheelToScaleFactor(300, 1)).toBe(0.5);
    expect(wheelToScaleFactor(-300, 1)).toBe(2);
  });
});

describe('boundedFactor', () => {
  it('never lets current * factor leave [0.25, 8]', () => {
    const grow = boundedFactor(7, 2);
    expect(7 * grow).toBeCloseTo(MAX_SCALE, 5);

    const shrink = boundedFactor(0.3, 0.5);
    expect(0.3 * shrink).toBeCloseTo(MIN_SCALE, 5);
  });

  it('returns 1 when already pinned at a bound', () => {
    expect(boundedFactor(MAX_SCALE, 2)).toBe(1);
    expect(boundedFactor(MIN_SCALE, 0.5)).toBe(1);
  });

  it('returns 1 when current is zero or negative', () => {
    expect(boundedFactor(0, 2)).toBe(1);
    expect(boundedFactor(-5, 2)).toBe(1);
  });
});

describe('anchorOrigin', () => {
  it('rebases client coordinates by the container rect and adds the container offset', () => {
    // A 220px sidebar pushes the viewer container's bounding rect to the right.
    const containerRect = { left: 220, top: 0 };
    const containerOffset = { left: 0, top: 0 };
    expect(anchorOrigin(420, 100, containerRect, containerOffset)).toEqual([200, 100]);
  });

  it('adds a non-zero offsetParent offset on top of the rect subtraction', () => {
    const containerRect = { left: 220, top: 50 };
    const containerOffset = { left: 5, top: 10 };
    expect(anchorOrigin(300, 150, containerRect, containerOffset)).toEqual([300 - 220 + 5, 150 - 50 + 10]);
  });
});

describe('formatZoomLabel', () => {
  it('formats a scale as a rounded percentage', () => {
    expect(formatZoomLabel(1)).toBe('100%');
    expect(formatZoomLabel(1.5)).toBe('150%');
    expect(formatZoomLabel(0.333)).toBe('33%');
  });

  it('clamps out-of-range or invalid scales before formatting', () => {
    expect(formatZoomLabel(NaN)).toBe('100%');
    expect(formatZoomLabel(100)).toBe('800%');
  });
});
