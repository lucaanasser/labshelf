import { ACTIONS_BLOCKED_WHILE_TYPING, cheatsheetRows, resolveKey, type KeyContext, type KeyInput } from '../../../src/reader/logic/keymap';

function ctx(overrides: Partial<KeyContext> = {}): KeyContext {
  return { vimKeys: false, isMac: false, inTextInput: false, pendingPrefix: null, ...overrides };
}

function key(overrides: Partial<KeyInput> & { key: string }): KeyInput {
  return { ctrl: false, meta: false, alt: false, shift: false, ...overrides };
}

describe('resolveKey - conventional bindings', () => {
  it('resolves the arrow keys to scroll and page navigation', () => {
    expect(resolveKey(key({ key: 'ArrowDown' }), ctx()).action).toBe('scrollDown');
    expect(resolveKey(key({ key: 'ArrowUp' }), ctx()).action).toBe('scrollUp');
    expect(resolveKey(key({ key: 'ArrowRight' }), ctx()).action).toBe('nextPage');
    expect(resolveKey(key({ key: 'ArrowLeft' }), ctx()).action).toBe('prevPage');
  });

  it('resolves PageDown/PageUp and treats Space/Shift+Space as the same screen scroll', () => {
    expect(resolveKey(key({ key: 'PageDown' }), ctx()).action).toBe('pageDown');
    expect(resolveKey(key({ key: 'PageUp' }), ctx()).action).toBe('pageUp');
    expect(resolveKey(key({ key: ' ', shift: false }), ctx()).action).toBe('pageDown');
    expect(resolveKey(key({ key: ' ', shift: true }), ctx()).action).toBe('pageUp');
  });

  it('resolves Home/End to first/last page', () => {
    expect(resolveKey(key({ key: 'Home' }), ctx()).action).toBe('firstPage');
    expect(resolveKey(key({ key: 'End' }), ctx()).action).toBe('lastPage');
  });

  it('resolves the platform mod+F to find and rejects the other platform modifier', () => {
    expect(resolveKey(key({ key: 'f', ctrl: true }), ctx({ isMac: false })).action).toBe('find');
    expect(resolveKey(key({ key: 'f', meta: true }), ctx({ isMac: true })).action).toBe('find');
    // Ctrl+F must NOT resolve on mac (mod is Cmd there).
    expect(resolveKey(key({ key: 'f', ctrl: true }), ctx({ isMac: true })).action).toBeNull();
    // Cmd+F must NOT resolve off mac (mod is Ctrl there).
    expect(resolveKey(key({ key: 'f', meta: true }), ctx({ isMac: false })).action).toBeNull();
  });

  it('resolves mod+G / mod+Shift+G to find navigation, distinct from mod+Alt+G (go to page)', () => {
    expect(resolveKey(key({ key: 'g', ctrl: true }), ctx({ isMac: false })).action).toBe('findNext');
    expect(resolveKey(key({ key: 'G', ctrl: true, shift: true }), ctx({ isMac: false })).action).toBe('findPrev');
    expect(resolveKey(key({ key: 'g', ctrl: true, alt: true }), ctx({ isMac: false })).action).toBe('goToPage');
  });

  it('resolves F3 / Shift+F3 to next/previous match', () => {
    expect(resolveKey(key({ key: 'F3' }), ctx()).action).toBe('findNext');
    expect(resolveKey(key({ key: 'F3', shift: true }), ctx()).action).toBe('findPrev');
  });

  it('resolves mod+=, mod++, mod+- and mod+0 to zoom actions', () => {
    expect(resolveKey(key({ key: '=', ctrl: true }), ctx({ isMac: false })).action).toBe('zoomIn');
    expect(resolveKey(key({ key: '+', ctrl: true }), ctx({ isMac: false })).action).toBe('zoomIn');
    expect(resolveKey(key({ key: '-', ctrl: true }), ctx({ isMac: false })).action).toBe('zoomOut');
    expect(resolveKey(key({ key: '0', ctrl: true }), ctx({ isMac: false })).action).toBe('zoomReset');
  });

  it('resolves Alt+Left/Alt+Right to history back/forward on every platform', () => {
    expect(resolveKey(key({ key: 'ArrowLeft', alt: true }), ctx({ isMac: false })).action).toBe('historyBack');
    expect(resolveKey(key({ key: 'ArrowRight', alt: true }), ctx({ isMac: false })).action).toBe('historyForward');
    expect(resolveKey(key({ key: 'ArrowLeft', alt: true }), ctx({ isMac: true })).action).toBe('historyBack');
    expect(resolveKey(key({ key: 'ArrowRight', alt: true }), ctx({ isMac: true })).action).toBe('historyForward');
  });

  it('resolves Cmd+[ / Cmd+] to history only on mac', () => {
    expect(resolveKey(key({ key: '[', meta: true }), ctx({ isMac: true })).action).toBe('historyBack');
    expect(resolveKey(key({ key: ']', meta: true }), ctx({ isMac: true })).action).toBe('historyForward');
    expect(resolveKey(key({ key: '[', meta: true }), ctx({ isMac: false })).action).toBeNull();
    expect(resolveKey(key({ key: ']', meta: true }), ctx({ isMac: false })).action).toBeNull();
    // Ctrl+[ is not a binding at all off mac (macOnly), even though Ctrl is the primary mod there.
    expect(resolveKey(key({ key: '[', ctrl: true }), ctx({ isMac: false })).action).toBeNull();
  });

  it('resolves F4 to toggleSidebar', () => {
    expect(resolveKey(key({ key: 'F4' }), ctx()).action).toBe('toggleSidebar');
  });

  it('resolves mod+Shift+C to copyWithCitation', () => {
    expect(resolveKey(key({ key: 'c', ctrl: true, shift: true }), ctx({ isMac: false })).action).toBe('copyWithCitation');
    expect(resolveKey(key({ key: 'C', meta: true, shift: true }), ctx({ isMac: true })).action).toBe('copyWithCitation');
  });

  it('resolves bare "?" to the cheatsheet and Escape to escape', () => {
    expect(resolveKey(key({ key: '?' }), ctx()).action).toBe('cheatsheet');
    expect(resolveKey(key({ key: 'Escape' }), ctx()).action).toBe('escape');
  });

  it('matches mod+Alt+G via KeyboardEvent.code when macOS Option rewrites `key` to a glyph', () => {
    // macOS rewrites Option+G to "©"; the binding must still fire using the physical code.
    const input = key({ key: '©', code: 'KeyG', meta: true, alt: true });
    expect(resolveKey(input, ctx({ isMac: true })).action).toBe('goToPage');
  });

  it('matches mod+Alt+G via the plain `key` when `code` is absent', () => {
    expect(resolveKey(key({ key: 'g', ctrl: true, alt: true }), ctx({ isMac: false })).action).toBe('goToPage');
  });
});

describe('resolveKey - stray modifiers', () => {
  it('does not match a bare binding when a non-primary modifier is also held', () => {
    // ArrowDown wants no modifier; a stray Meta off mac (where mod is Ctrl) must block it.
    expect(resolveKey(key({ key: 'ArrowDown', meta: true }), ctx({ isMac: false })).action).toBeNull();
    // Escape wants no modifier; a stray Ctrl on mac (where mod is Cmd) must block it.
    expect(resolveKey(key({ key: 'Escape', ctrl: true }), ctx({ isMac: true })).action).toBeNull();
  });
});

describe('resolveKey - vim layer', () => {
  it('ignores every vim binding when vimKeys is false', () => {
    expect(resolveKey(key({ key: 'j' }), ctx({ vimKeys: false })).action).toBeNull();
    expect(resolveKey(key({ key: 'h' }), ctx({ vimKeys: false })).action).toBeNull();
    expect(resolveKey(key({ key: '/' }), ctx({ vimKeys: false })).action).toBeNull();
  });

  it('resolves j/k/h/l to scroll directions', () => {
    expect(resolveKey(key({ key: 'j' }), ctx({ vimKeys: true })).action).toBe('scrollDown');
    expect(resolveKey(key({ key: 'k' }), ctx({ vimKeys: true })).action).toBe('scrollUp');
    expect(resolveKey(key({ key: 'h' }), ctx({ vimKeys: true })).action).toBe('scrollLeft');
    expect(resolveKey(key({ key: 'l' }), ctx({ vimKeys: true })).action).toBe('scrollRight');
  });

  it('resolves d/u to half-page scroll', () => {
    expect(resolveKey(key({ key: 'd' }), ctx({ vimKeys: true })).action).toBe('halfPageDown');
    expect(resolveKey(key({ key: 'u' }), ctx({ vimKeys: true })).action).toBe('halfPageUp');
  });

  it('resolves J/K/G to page navigation', () => {
    expect(resolveKey(key({ key: 'J', shift: true }), ctx({ vimKeys: true })).action).toBe('nextPage');
    expect(resolveKey(key({ key: 'K', shift: true }), ctx({ vimKeys: true })).action).toBe('prevPage');
    expect(resolveKey(key({ key: 'G', shift: true }), ctx({ vimKeys: true })).action).toBe('lastPage');
  });

  it('resolves : to goToPage', () => {
    expect(resolveKey(key({ key: ':', shift: true }), ctx({ vimKeys: true })).action).toBe('goToPage');
  });

  it('resolves H/L to history back/forward', () => {
    expect(resolveKey(key({ key: 'H', shift: true }), ctx({ vimKeys: true })).action).toBe('historyBack');
    expect(resolveKey(key({ key: 'L', shift: true }), ctx({ vimKeys: true })).action).toBe('historyForward');
  });

  it('resolves / to find, and treats n and N as distinct actions', () => {
    expect(resolveKey(key({ key: '/' }), ctx({ vimKeys: true })).action).toBe('find');
    expect(resolveKey(key({ key: 'n' }), ctx({ vimKeys: true })).action).toBe('findNext');
    expect(resolveKey(key({ key: 'N', shift: true }), ctx({ vimKeys: true })).action).toBe('findPrev');
  });

  it('resolves +/- to zoom, w/e to fit modes and t to toggle sidebar', () => {
    expect(resolveKey(key({ key: '+' }), ctx({ vimKeys: true })).action).toBe('zoomIn');
    expect(resolveKey(key({ key: '=' }), ctx({ vimKeys: true })).action).toBe('zoomIn');
    expect(resolveKey(key({ key: '-' }), ctx({ vimKeys: true })).action).toBe('zoomOut');
    expect(resolveKey(key({ key: 'w' }), ctx({ vimKeys: true })).action).toBe('fitWidth');
    expect(resolveKey(key({ key: 'e' }), ctx({ vimKeys: true })).action).toBe('fitPage');
    expect(resolveKey(key({ key: 't' }), ctx({ vimKeys: true })).action).toBe('toggleSidebar');
  });
});

describe('resolveKey - "gg" chord', () => {
  it('returns pendingPrefix "g" with no action on the first g', () => {
    const res = resolveKey(key({ key: 'g' }), ctx({ vimKeys: true, pendingPrefix: null }));
    expect(res).toEqual({ action: null, pendingPrefix: 'g' });
  });

  it('resolves to firstPage on the second g when pendingPrefix is "g"', () => {
    const res = resolveKey(key({ key: 'g' }), ctx({ vimKeys: true, pendingPrefix: 'g' }));
    expect(res).toEqual({ action: 'firstPage', pendingPrefix: null });
  });

  it('clears the pending prefix on any other key, whether or not it resolves', () => {
    const mapped = resolveKey(key({ key: 'j' }), ctx({ vimKeys: true, pendingPrefix: 'g' }));
    expect(mapped).toEqual({ action: 'scrollDown', pendingPrefix: null });

    const unmapped = resolveKey(key({ key: 'x' }), ctx({ vimKeys: true, pendingPrefix: 'g' }));
    expect(unmapped).toEqual({ action: null, pendingPrefix: null });
  });
});

describe('resolveKey - inTextInput', () => {
  it('resolves bare keys to nothing, including vim keys and "?"', () => {
    expect(resolveKey(key({ key: 'a' }), ctx({ inTextInput: true })).action).toBeNull();
    expect(resolveKey(key({ key: '?' }), ctx({ inTextInput: true })).action).toBeNull();
    expect(resolveKey(key({ key: 'j' }), ctx({ vimKeys: true, inTextInput: true })).action).toBeNull();
    expect(resolveKey(key({ key: 'G', shift: true }), ctx({ vimKeys: true, inTextInput: true })).action).toBeNull();
  });

  it('still resolves mod chords', () => {
    expect(resolveKey(key({ key: 'f', ctrl: true }), ctx({ isMac: false, inTextInput: true })).action).toBe('find');
  });

  it('leaves Alt/Option+Arrow to the text field (move by word) instead of navigating history', () => {
    const left = key({ key: 'ArrowLeft', alt: true });
    const right = key({ key: 'ArrowRight', alt: true });
    expect(resolveKey(left, ctx({ inTextInput: true })).action).toBeNull();
    expect(resolveKey(right, ctx({ inTextInput: true })).action).toBeNull();
    // Outside a text field the same chords are history navigation.
    expect(resolveKey(left, ctx()).action).toBe('historyBack');
    expect(resolveKey(right, ctx()).action).toBe('historyForward');
    // Every action blocked while typing is a history action, nothing else.
    expect([...ACTIONS_BLOCKED_WHILE_TYPING].sort()).toEqual(['historyBack', 'historyForward']);
  });

  it('still resolves F3 and Escape', () => {
    expect(resolveKey(key({ key: 'F3' }), ctx({ inTextInput: true })).action).toBe('findNext');
    expect(resolveKey(key({ key: 'Escape' }), ctx({ inTextInput: true })).action).toBe('escape');
  });

  it('does not let a bare key with a stray Ctrl/Meta slip through as a match', () => {
    // F3 alone would resolve (see above); F3 + a stray Meta (non-primary off mac) must not.
    const input = key({ key: 'F3', meta: true });
    expect(resolveKey(input, ctx({ isMac: false, inTextInput: true })).action).toBeNull();
  });
});

describe('cheatsheetRows', () => {
  it('excludes vim-only rows and the "gg" chord when vim keys are disabled', () => {
    const rows = cheatsheetRows({ vimKeys: false, isMac: false });
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Scroll left');
    expect(labels).not.toContain('Fit width');
    expect(rows.some((r) => r.keys.includes('gg'))).toBe(false);
  });

  it('includes "gg" and every vim key when vim keys are enabled', () => {
    const rows = cheatsheetRows({ vimKeys: true, isMac: false });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Scroll left');
    expect(labels).toContain('Fit width');

    const firstPage = rows.find((r) => r.label === 'First page');
    expect(firstPage?.keys).toContain('Home');
    expect(firstPage?.keys).toContain('gg');
  });

  it('uses "Cmd" on mac and "Ctrl" otherwise', () => {
    const macFind = cheatsheetRows({ vimKeys: false, isMac: true }).find((r) => r.label === 'Find in document');
    const winFind = cheatsheetRows({ vimKeys: false, isMac: false }).find((r) => r.label === 'Find in document');
    expect(macFind?.keys).toContain('Cmd+F');
    expect(winFind?.keys).toContain('Ctrl+F');
  });

  it('shows mac-only rows only on mac', () => {
    const macBack = cheatsheetRows({ vimKeys: false, isMac: true }).find((r) => r.label === 'Back');
    const winBack = cheatsheetRows({ vimKeys: false, isMac: false }).find((r) => r.label === 'Back');
    expect(macBack?.keys).toContain('Cmd+[');
    expect(winBack?.keys.some((k) => k.includes('['))).toBe(false);
  });

  it('groups rows in order Navigate, Search, Zoom, View', () => {
    const rows = cheatsheetRows({ vimKeys: true, isMac: false });
    const order = ['Navigate', 'Search', 'Zoom', 'View'];
    let lastIndex = -1;
    for (const row of rows) {
      const index = order.indexOf(row.group);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
    expect(new Set(rows.map((r) => r.group))).toEqual(new Set(order));
  });
});
