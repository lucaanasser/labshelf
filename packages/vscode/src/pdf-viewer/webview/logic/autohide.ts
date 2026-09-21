/**
 * Decides when the overlay toolbar is visible. Kept as a pure reducer so the feel (thresholds, pinning conditions) is unit-tested rather than tuned by hand in DOM handlers.
 *
 * @depends none
 * @dependents pdf-viewer/webview/ui/toolbar.ts
 */

export const HIDE_AFTER_DOWN_PX = 24;
export const SHOW_AFTER_UP_PX = 8;
export const POINTER_REVEAL_PX = 48;
export const TOP_REVEAL_PX = 8;

export interface AutohideState {
  visible: boolean;
  /** Cumulative scroll distance in the current direction; sign is the direction (+ down, - up). */
  travel: number;
}

export interface AutohideInputs {
  enabled: boolean;
  /**
   * False until the reader first scrolls by hand (wheel, key, touch, scrollbar). pdf.js scrolls programmatically
   * while opening and restoring a position; that must not hide the toolbar before the reader has even seen it.
   * Omitted means engaged.
   */
  engaged?: boolean;
  scrollTop: number;
  pointerY: number | null;
  focusWithin: boolean;
  findOpen: boolean;
  menuOpen: boolean;
}

export type AutohideEvent =
  | { kind: "scroll"; delta: number }
  | { kind: "inputs" };

export const initialAutohide: AutohideState = { visible: true, travel: 0 };

function pinned(i: AutohideInputs): boolean {
  return !i.enabled
    || i.engaged === false
    || i.focusWithin
    || i.findOpen
    || i.menuOpen
    || i.scrollTop < TOP_REVEAL_PX
    || (i.pointerY !== null && i.pointerY < POINTER_REVEAL_PX);
}

/**
 * @usedBy pdf-viewer/webview/ui/toolbar.ts
 * @returns the next state; callers apply `visible` to the DOM only when it changes.
 */
export function toolbarVisibility(
  state: AutohideState,
  event: AutohideEvent,
  inputs: AutohideInputs,
): AutohideState {
  if (pinned(inputs)) { return { visible: true, travel: 0 }; }
  if (event.kind === "inputs") {
    // A pin was just released (pointer left the top, menu closed): stay as-is until the reader scrolls.
    return state;
  }
  const sameDirection = Math.sign(event.delta) === Math.sign(state.travel);
  const travel = sameDirection ? state.travel + event.delta : event.delta;
  if (travel > HIDE_AFTER_DOWN_PX) { return { visible: false, travel }; }
  if (travel <= -SHOW_AFTER_UP_PX) { return { visible: true, travel }; }
  return { visible: state.visible, travel };
}
