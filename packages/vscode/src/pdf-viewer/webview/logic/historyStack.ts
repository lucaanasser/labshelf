/**
 * Browser-style back/forward stack of reading positions. pdf.js' own PDFHistory rides on window.history and the URL hash, neither of which is usable inside a VS Code webview.
 *
 * @depends none
 * @dependents pdf-viewer/webview/ui/navHistory.ts
 */

export interface ViewLocation {
  pageNumber: number;
  /** pdf.js location space (PDF points). */
  left?: number;
  top?: number;
  scaleValue?: string;
}

export const HISTORY_CAP = 50;
// Two positions closer than this on the same page are one place to a reader.
const NEAR_POINTS = 120;

/**
 * @usedBy HistoryStack.visit
 * @returns true when both locations are on the same page and close enough to count as one place.
 */
export function isNearLocation(a: ViewLocation, b: ViewLocation): boolean {
  if (a.pageNumber !== b.pageNumber) { return false; }
  return Math.abs((a.top ?? 0) - (b.top ?? 0)) < NEAR_POINTS;
}

/**
 * The stack stores departure points. `visit(from)` is called right before a jump; `back(current)` swaps the current position onto the forward side so the round trip is lossless.
 * @usedBy pdf-viewer/webview/ui/navHistory.ts
 */
export class HistoryStack {
  private backStack: ViewLocation[] = [];
  private forwardStack: ViewLocation[] = [];

  /**
   * Records the position being left by a jump; any forward branch is discarded, as in a browser.
   * @usedBy pdf-viewer/webview/ui/navHistory.ts (NavHistory.visit)
   * @returns void
   */
  visit(from: ViewLocation): void {
    this.forwardStack = [];
    const last = this.backStack[this.backStack.length - 1];
    if (last && isNearLocation(last, from)) { return; }
    this.backStack.push(from);
    if (this.backStack.length > HISTORY_CAP) { this.backStack.shift(); }
  }

  /**
   * Pops the most recent departure point and pushes `current` onto the forward stack so the trip can be replayed.
   * @usedBy pdf-viewer/webview/ui/navHistory.ts (NavHistory.back)
   * @returns the location to jump to, or null when the back stack is empty.
   */
  back(current: ViewLocation): ViewLocation | null {
    const target = this.backStack.pop();
    if (!target) { return null; }
    this.forwardStack.push(current);
    return target;
  }

  /**
   * Pops the most recent forward target and pushes `current` back onto the back stack.
   * @usedBy pdf-viewer/webview/ui/navHistory.ts (NavHistory.forward)
   * @returns the location to jump to, or null when the forward stack is empty.
   */
  forward(current: ViewLocation): ViewLocation | null {
    const target = this.forwardStack.pop();
    if (!target) { return null; }
    this.backStack.push(current);
    return target;
  }

  get canGoBack(): boolean { return this.backStack.length > 0; }
  get canGoForward(): boolean { return this.forwardStack.length > 0; }

  /**
   * Empties both the back and forward stacks.
   * @usedBy none currently in src
   * @returns void
   */
  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }
}
