/**
 * Unit tests for telling an OCR text layer from a born-digital one: OCR tools
 * draw their text invisibly (render mode 3) over the scanned image.
 */
import { invisibleShare } from '../../src/pdf/tesseractOcrEngine';

const OPS = { save: 10, restore: 11, setTextRenderingMode: 39, showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47, paintImageXObject: 85 };
const list = (...ops: Array<[number, unknown[]?]>) => ({ fnArray: ops.map(([fn]) => fn), argsArray: ops.map(([, args]) => args ?? []) });

describe('invisibleShare', () => {
  it('counts the text runs drawn in an invisible mode', () => {
    const ops = list(
      [OPS.paintImageXObject],
      [OPS.showText], // a visible stamp
      [OPS.setTextRenderingMode, [3]], [OPS.showText], [OPS.showSpacedText], [OPS.nextLineShowText],
    );
    expect(invisibleShare(ops, OPS)).toBe(0.75);
  });

  it('follows the mode through save and restore, and treats clip-only text as invisible', () => {
    const ops = list(
      [OPS.save], [OPS.setTextRenderingMode, [3]], [OPS.showText], [OPS.restore],
      [OPS.showText],
      [OPS.setTextRenderingMode, [7]], [OPS.nextLineSetSpacingShowText],
    );
    expect(invisibleShare(ops, OPS)).toBeCloseTo(2 / 3);
  });

  it('returns undefined for a page with no text at all', () => {
    expect(invisibleShare(list([OPS.paintImageXObject]), OPS)).toBeUndefined();
  });
});
