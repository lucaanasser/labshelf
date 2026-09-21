import { HISTORY_CAP, HistoryStack, type ViewLocation } from '../../../../src/pdf-viewer/webview/logic/historyStack';

function loc(pageNumber: number, top = 0): ViewLocation {
  return { pageNumber, top };
}

describe('HistoryStack', () => {
  describe('visit / back / forward', () => {
    it('is lossless on a simple round trip', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));

      const backTarget = stack.back(loc(2));
      expect(backTarget).toEqual(loc(1));

      const forwardTarget = stack.forward(loc(1));
      expect(forwardTarget).toEqual(loc(2));

      // The stack is back to the state right after the initial visit.
      expect(stack.canGoBack).toBe(true);
      expect(stack.canGoForward).toBe(false);
    });

    it('discards the forward branch on a new visit', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));
      stack.back(loc(2));
      expect(stack.canGoForward).toBe(true);

      stack.visit(loc(1));
      expect(stack.canGoForward).toBe(false);
    });
  });

  describe('visit deduplication', () => {
    it('drops a near-duplicate consecutive visit but keeps a different page or a far offset', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1, 100));
      stack.visit(loc(1, 150)); // same page, |delta| = 50 < 120: deduped against the last entry
      expect(stack.back(loc(1, 150))).toEqual(loc(1, 100));
      expect(stack.canGoBack).toBe(false);

      stack.visit(loc(1, 100));
      stack.visit(loc(1, 300)); // same page, |delta| = 200 >= 120: kept
      stack.visit(loc(2, 100)); // different page: kept regardless of offset

      expect(stack.back(loc(99))).toEqual(loc(2, 100));
      expect(stack.back(loc(2, 100))).toEqual(loc(1, 300));
      expect(stack.back(loc(1, 300))).toEqual(loc(1, 100));
      expect(stack.canGoBack).toBe(false);
    });
  });

  describe('cap', () => {
    it(`keeps at most ${HISTORY_CAP} entries, dropping the oldest`, () => {
      const stack = new HistoryStack();
      for (let page = 1; page <= HISTORY_CAP + 1; page++) {
        stack.visit(loc(page));
      }

      const popped: ViewLocation[] = [];
      let current = loc(9999);
      while (stack.canGoBack) {
        const target = stack.back(current);
        if (!target) { break; }
        popped.push(target);
        current = target;
      }

      expect(popped).toHaveLength(HISTORY_CAP);
      // The very first visit (page 1) was evicted; the most recent (HISTORY_CAP + 1) pops first.
      expect(popped[0]).toEqual(loc(HISTORY_CAP + 1));
      expect(popped.some((p) => p.pageNumber === 1)).toBe(false);
      expect(popped[popped.length - 1]).toEqual(loc(2));
    });
  });

  describe('canGoBack / canGoForward', () => {
    it('reflect the current stack contents', () => {
      const stack = new HistoryStack();
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(false);

      stack.visit(loc(1));
      expect(stack.canGoBack).toBe(true);

      stack.back(loc(2));
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(true);
    });
  });

  describe('back / forward on an empty stack', () => {
    it('return null and do not mutate the other stack', () => {
      const stack = new HistoryStack();
      expect(stack.back(loc(1))).toBeNull();
      expect(stack.canGoForward).toBe(false);

      expect(stack.forward(loc(1))).toBeNull();
      expect(stack.canGoBack).toBe(false);
    });
  });

  describe('clear', () => {
    it('empties both stacks', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));
      stack.back(loc(2));
      expect(stack.canGoBack || stack.canGoForward).toBe(true);

      stack.clear();
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(false);
    });
  });
});
