/**
 * Pure zoom arithmetic for the reader: scale clamping, button steps, wheel/pinch deltas and the cursor-anchored origin pdf.js expects.
 *
 * @depends none
 * @dependents pdf-viewer/webview/ui/zoomController.ts, pdf-viewer/webview/ui/statusPill.ts, pdf-viewer/webview/ui/readingStateReporter.ts
 */

// Beyond 8x a HiDPI page canvas costs hundreds of megapixels even with pdf.js' detail canvas.
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];

const PRESETS = new Set(["page-width", "page-fit", "page-actual", "auto"]);

/**
 * @usedBy pdf-viewer/webview/ui/zoomController.ts
 * @returns the scale limited to [MIN_SCALE, MAX_SCALE]; 1 for a non-finite input.
 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) { return 1; }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * True for the pdf.js scale values that depend on the container size and so must be re-applied on resize.
 * @usedBy pdf-viewer/webview/ui/zoomController.ts, pdf-viewer/webview/ui/readingStateReporter.ts
 * @returns whether `value` is one of the preset scale names rather than a numeric zoom.
 */
export function isPresetScale(value: string | null | undefined): boolean {
  return typeof value === "string" && PRESETS.has(value);
}

/**
 * Next rung of the zoom ladder for the +/- buttons and keys.
 * @usedBy pdf-viewer/webview/ui/zoomController.ts
 * @returns the neighbouring step, or the clamped current scale at either end.
 */
export function nextZoomStep(current: number, direction: 1 | -1): number {
  const eps = 0.005;
  if (direction > 0) {
    return ZOOM_STEPS.find((s) => s > current + eps) ?? MAX_SCALE;
  }
  return [...ZOOM_STEPS].reverse().find((s) => s < current - eps) ?? MIN_SCALE;
}

const DOM_DELTA_PIXEL = 0;
const WHEEL_NOTCH_PX = 50;

/**
 * Converts one ctrl/cmd+wheel event into a multiplicative scale factor.
 * Trackpad pinches arrive as many small pixel deltas and map smoothly; mouse wheels arrive as coarse notches and map to 10% steps.
 * @usedBy pdf-viewer/webview/ui/zoomController.ts
 * @returns a factor in [0.5, 2]; 1 means no change.
 */
export function wheelToScaleFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) { return 1; }
  let factor: number;
  if (deltaMode !== DOM_DELTA_PIXEL || Math.abs(deltaY) >= WHEEL_NOTCH_PX) {
    const notches = deltaMode !== DOM_DELTA_PIXEL
      ? Math.max(1, Math.round(Math.abs(deltaY) / 3))
      : Math.max(1, Math.round(Math.abs(deltaY) / 100));
    factor = Math.pow(1.1, -Math.sign(deltaY) * notches);
  } else {
    factor = Math.exp(-deltaY / 100);
  }
  return Math.min(2, Math.max(0.5, factor));
}

/**
 * Limits a factor so `current * factor` stays inside [MIN_SCALE, MAX_SCALE].
 * @usedBy pdf-viewer/webview/ui/zoomController.ts
 * @returns the (possibly reduced) factor; 1 when already pinned at a bound.
 */
export function boundedFactor(current: number, factor: number): number {
  if (!(current > 0)) { return 1; }
  return clampScale(current * factor) / current;
}

export interface Box {
  left: number;
  top: number;
}

/**
 * pdf.js' `updateScale({origin})` subtracts `[container.offsetLeft, container.offsetTop]`, which are relative to the offsetParent, not the viewport.
 * A raw clientX/clientY would therefore drift by the sidebar width; this rebases the pointer into that space.
 * @usedBy pdf-viewer/webview/ui/zoomController.ts
 * @returns `[x, y]` to pass as `origin`.
 */
export function anchorOrigin(
  clientX: number,
  clientY: number,
  containerRect: Box,
  containerOffset: Box,
): [number, number] {
  return [
    clientX - containerRect.left + containerOffset.left,
    clientY - containerRect.top + containerOffset.top,
  ];
}

/**
 * @usedBy pdf-viewer/webview/ui/statusPill.ts
 * @returns the scale as a whole percentage, e.g. "125%".
 */
export function formatZoomLabel(scale: number): string {
  return `${Math.round(clampScale(scale) * 100)}%`;
}
