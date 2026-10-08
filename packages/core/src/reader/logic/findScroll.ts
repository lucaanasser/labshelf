/**
 * Where a find hit should sit on screen. pdf.js always scrolls the hit to 50px below the container top, which is
 * underneath the reader's overlay toolbar and find bar, and it re-scrolls even when the next hit is already in view.
 */

/** Toolbar + find bar + breathing room, in CSS px. */
export const FIND_OVERLAY_PX = 110;
const BOTTOM_MARGIN_PX = 64;
const TARGET_RATIO = 0.3;

export interface MatchBox {
  /** Hit edges relative to the container's top edge, as they were when the find command was issued (before pdf.js scrolled anything). */
  top: number;
  bottom: number;
}

/** A scroll position remembered at find time is only trusted this long; a late text-layer render must not yank the reader back. */
export const FIND_ORIGIN_TTL_MS = 3000;

export interface FindOrigin {
  top: number;
  left: number;
  at: number;
}

/**
 * @returns the origin if it is still fresh, else null.
 */
export function freshOrigin(origin: FindOrigin | null, now: number): FindOrigin | null {
  return origin && now - origin.at <= FIND_ORIGIN_TTL_MS ? origin : null;
}

export type MatchScrollDecision =
  | { kind: "stay" }
  | { kind: "place"; top: number };

/**
 * @returns "stay" when the hit was already comfortably readable (stepping through hits on one screen should not move the page), otherwise the offset from the container top at which to place the hit.
 */
export function decideMatchScroll(before: MatchBox | null, containerHeight: number): MatchScrollDecision {
  // Without a known starting position there is nothing to stay at.
  const comfortable = before !== null
    && before.top >= FIND_OVERLAY_PX
    && before.bottom <= containerHeight - BOTTOM_MARGIN_PX;
  if (comfortable) { return { kind: "stay" }; }
  return { kind: "place", top: Math.max(FIND_OVERLAY_PX, Math.round(containerHeight * TARGET_RATIO)) };
}
