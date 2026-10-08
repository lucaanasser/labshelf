/**
 * Parses pdf.js explicit destinations and computes the crop rectangle for hover previews.
 */

export interface DestPoint {
  /** PDF user-space coordinates (origin bottom-left); null when the destination does not pin that axis. */
  x: number | null;
  y: number | null;
  kind: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Reads the target point out of an explicit destination array `[pageRef, {name}, ...args]`.
 * @returns the point, or null when `dest` is not a well-formed explicit destination.
 */
export function destPoint(dest: unknown): DestPoint | null {
  if (!Array.isArray(dest) || dest.length < 2) { return null; }
  const mode = dest[1] as { name?: unknown } | null;
  const kind = mode && typeof mode === "object" && typeof mode.name === "string" ? mode.name : null;
  if (!kind) { return null; }
  switch (kind) {
    case "XYZ":
      return { kind, x: num(dest[2]), y: num(dest[3]) };
    case "FitH":
    case "FitBH":
      return { kind, x: null, y: num(dest[2]) };
    case "FitV":
    case "FitBV":
      return { kind, x: num(dest[2]), y: null };
    case "FitR":
      // [left, bottom, right, top]
      return { kind, x: num(dest[2]), y: num(dest[5]) };
    case "Fit":
    case "FitB":
      return { kind, x: null, y: null };
    default:
      return null;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOptions {
  /** Fraction of the page height shown in the popup. */
  heightRatio?: number;
  /** Context kept above the anchor so a figure caption or heading is not cut at its first line. */
  leadRatio?: number;
}

/**
 * Crop window, in viewport pixels (origin top-left), around a destination's y. Full page width: figures, tables and equations span it unpredictably.
 * @returns a rect clamped inside the page.
 */
export function cropRectForPreview(
  anchorY: number | null,
  pageWidth: number,
  pageHeight: number,
  opts: CropOptions = {},
): Rect {
  const heightRatio = opts.heightRatio ?? 0.38;
  const leadRatio = opts.leadRatio ?? 0.04;
  const height = Math.min(pageHeight, Math.max(1, pageHeight * heightRatio));
  const wanted = anchorY === null ? 0 : anchorY - pageHeight * leadRatio;
  const y = Math.min(Math.max(0, wanted), Math.max(0, pageHeight - height));
  return { x: 0, y, width: pageWidth, height };
}
