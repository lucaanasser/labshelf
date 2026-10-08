import { cropRectForPreview, destPoint } from '../../../src/reader/logic/destGeometry';

describe('destPoint', () => {
  it('reads x/y from an XYZ destination', () => {
    expect(destPoint([{ num: 1 }, { name: 'XYZ' }, 100, 200, 1.5])).toEqual({ kind: 'XYZ', x: 100, y: 200 });
  });

  it('reads only y from FitH/FitBH', () => {
    expect(destPoint([{ num: 1 }, { name: 'FitH' }, 300])).toEqual({ kind: 'FitH', x: null, y: 300 });
    expect(destPoint([{ num: 1 }, { name: 'FitBH' }, 300])).toEqual({ kind: 'FitBH', x: null, y: 300 });
  });

  it('reads only x from FitV/FitBV', () => {
    expect(destPoint([{ num: 1 }, { name: 'FitV' }, 150])).toEqual({ kind: 'FitV', x: 150, y: null });
    expect(destPoint([{ num: 1 }, { name: 'FitBV' }, 150])).toEqual({ kind: 'FitBV', x: 150, y: null });
  });

  it('reads x from index 2 (left) and y from index 5 (top) for FitR', () => {
    // [pageRef, {name}, left, bottom, right, top]
    expect(destPoint([{ num: 1 }, { name: 'FitR' }, 10, 20, 300, 400])).toEqual({ kind: 'FitR', x: 10, y: 400 });
  });

  it('reads neither coordinate for Fit/FitB', () => {
    expect(destPoint([{ num: 1 }, { name: 'Fit' }])).toEqual({ kind: 'Fit', x: null, y: null });
    expect(destPoint([{ num: 1 }, { name: 'FitB' }])).toEqual({ kind: 'FitB', x: null, y: null });
  });

  it('preserves an explicit null coordinate as null', () => {
    expect(destPoint([{ num: 1 }, { name: 'XYZ' }, null, 500, 0])).toEqual({ kind: 'XYZ', x: null, y: 500 });
  });

  it('returns null for malformed input', () => {
    expect(destPoint('XYZ')).toBeNull(); // not an array
    expect(destPoint(null)).toBeNull();
    expect(destPoint(undefined)).toBeNull();
    expect(destPoint([{ num: 1 }])).toBeNull(); // too short (length < 2)
    expect(destPoint([{ num: 1 }, {}])).toBeNull(); // mode object missing `name`
    expect(destPoint([{ num: 1 }, 'XYZ'])).toBeNull(); // mode is not an object
    expect(destPoint([{ num: 1 }, { name: 'Bogus' }, 1, 2])).toBeNull(); // unknown kind
  });
});

describe('cropRectForPreview', () => {
  const pageWidth = 600;
  const pageHeight = 1000;

  it('always spans the full page width', () => {
    const rect = cropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(pageWidth);
  });

  it('defaults to 38% of the page height', () => {
    const rect = cropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.height).toBe(380);
  });

  it('keeps a lead margin above the anchor', () => {
    // 4% of 1000 = 40px of lead above the anchor y.
    const rect = cropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.y).toBe(460);
  });

  it('clamps at the top of the page', () => {
    const rect = cropRectForPreview(10, pageWidth, pageHeight);
    expect(rect.y).toBe(0);
  });

  it('clamps at the bottom of the page', () => {
    const rect = cropRectForPreview(990, pageWidth, pageHeight);
    expect(rect.y + rect.height).toBe(pageHeight);
    expect(rect.y).toBe(pageHeight - 380);
  });

  it('defaults to the top of the page when the anchor is null', () => {
    const rect = cropRectForPreview(null, pageWidth, pageHeight);
    expect(rect.y).toBe(0);
  });
});
