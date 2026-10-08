import { initialAutohide, toolbarVisibility, type AutohideInputs, type AutohideState } from '../../../src/reader/logic/autohide';

function inputs(overrides: Partial<AutohideInputs> = {}): AutohideInputs {
  return {
    enabled: true,
    scrollTop: 100,
    pointerY: 200,
    focusWithin: false,
    findOpen: false,
    menuOpen: false,
    ...overrides,
  };
}

function scroll(delta: number): { kind: 'scroll'; delta: number } {
  return { kind: 'scroll', delta };
}

describe('toolbarVisibility', () => {
  it('hides only after cumulative downward travel exceeds 24px, across several small scrolls', () => {
    let state: AutohideState = initialAutohide;
    state = toolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: true, travel: 10 });

    state = toolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: true, travel: 20 });

    // Cumulative travel now 30, past the 24px threshold.
    state = toolbarVisibility(state, scroll(10), inputs());
    expect(state).toEqual({ visible: false, travel: 30 });
  });

  it('shows after at least 8px of cumulative upward scroll', () => {
    let state: AutohideState = { visible: false, travel: 30 };
    state = toolbarVisibility(state, scroll(-3), inputs());
    expect(state.visible).toBe(false); // -3px alone is not enough

    state = toolbarVisibility(state, scroll(-3), inputs());
    expect(state.visible).toBe(false); // cumulative -6px, still short

    state = toolbarVisibility(state, scroll(-3), inputs());
    expect(state).toEqual({ visible: true, travel: -9 }); // cumulative -9px crosses -8px
  });

  it('resets the travel counter when the scroll direction changes', () => {
    const state: AutohideState = { visible: true, travel: 15 };
    const next = toolbarVisibility(state, scroll(-3), inputs());
    // Travel is reset to the new delta, not accumulated (15 - 3 would be 12).
    expect(next.travel).toBe(-3);
    expect(next.visible).toBe(true);
  });

  describe('pin conditions force visible and reset travel', () => {
    const dirty: AutohideState = { visible: false, travel: 50 };

    it('enabled = false', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ enabled: false }))).toEqual({ visible: true, travel: 0 });
    });

    it('focusWithin', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ focusWithin: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('findOpen', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ findOpen: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('menuOpen', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ menuOpen: true }))).toEqual({ visible: true, travel: 0 });
    });

    it('scrollTop < 8', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ scrollTop: 5 }))).toEqual({ visible: true, travel: 0 });
    });

    it('pointerY < 48', () => {
      expect(toolbarVisibility(dirty, scroll(5), inputs({ pointerY: 30 }))).toEqual({ visible: true, travel: 0 });
    });

    it('a null pointerY does not pin by itself', () => {
      // pointerY only pins when it is a number below the threshold; null means "pointer elsewhere".
      const result = toolbarVisibility(dirty, scroll(5), inputs({ pointerY: null }));
      expect(result).not.toEqual({ visible: true, travel: 0 });
    });
  });

  it('keeps the current state on an "inputs" event until the next scroll, once a pin is released', () => {
    const stateBeforeRelease: AutohideState = { visible: false, travel: 99 };
    const releasedInputs = inputs({ pointerY: 200 }); // no longer pinned

    const result = toolbarVisibility(stateBeforeRelease, { kind: 'inputs' }, releasedInputs);
    expect(result).toEqual(stateBeforeRelease);

    // A subsequent scroll resumes normal accumulation from that retained state
    // (same downward direction, so the new delta adds onto the stored travel).
    const afterScroll = toolbarVisibility(result, scroll(5), releasedInputs);
    expect(afterScroll.travel).toBe(104);
  });

  it('stays visible through pdf.js\' own scrolling until the reader first moves (engaged: false)', () => {
    // Opening and restoring a position scroll the container programmatically by thousands of pixels.
    let state: AutohideState = initialAutohide;
    state = toolbarVisibility(state, scroll(4000), inputs({ engaged: false }));
    expect(state).toEqual({ visible: true, travel: 0 });

    // Once the reader has scrolled by hand, ordinary auto-hide applies.
    state = toolbarVisibility(state, scroll(30), inputs({ engaged: true }));
    expect(state.visible).toBe(false);
  });

  it('treats an omitted engaged flag as engaged', () => {
    const state = toolbarVisibility(initialAutohide, scroll(30), inputs());
    expect(state.visible).toBe(false);
  });
});
