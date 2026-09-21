/**
 * Locates figures, tables and numbered equations from the page text alone, so "Fig. 3" can be previewed in PDFs that
 * carry no link annotations (scans made searchable by OCR, papers typeset without hyperlinks).
 * A caption is a line that STARTS with the label; the float itself is the text-free band next to it.
 *
 * @depends pdf-viewer/webview/logic/textLines.ts, pdf-viewer/webview/logic/inTextRefs.ts
 * @dependents pdf-viewer/webview/ui/floatResolver.ts
 */
import { FIGURE_WORD, FLOAT_LABEL, floatKindOf, type FloatKind } from "./inTextRefs.js";
import type { TextLine } from "./textLines.js";

export interface CaptionHit {
  kind: FloatKind;
  /** Lower-cased label as printed: "3", "3a", "1.1". */
  label: string;
  lineIndex: number;
}

// "Figure 3.", "Fig. 3:", "FIGURA 1 –", "Table 2 Summary of…" — but not "Figure 3 shows that…" (a sentence that merely
// starts a line): after the number comes punctuation, the end of the line, or a capitalised word.
// The label is matched case-insensitively; what follows is checked separately, because under the `i` flag \p{Lu} would
// accept lower-case letters too.
const CAPTION_LABEL = new RegExp(`^(${FIGURE_WORD}|Tab(?:le|ela|la)?s?|Quadro|Cuadro|Gr[áa]fico|Chart)\\s*\\.?\\s*(${FLOAT_LABEL})(?![\\p{L}\\d])`, "iu");
const CAPTION_REST = /^\s*(?:[.:\-–—)]|$|\p{Lu})/u;
// A display equation is numbered at the right margin: "... = mc^2   (5)", or "(2.3)" when numbered within sections.
const EQUATION_TAIL = new RegExp(`\\((${FLOAT_LABEL})\\)\\s*$`);

/**
 * @usedBy pdf-viewer/webview/ui/floatResolver.ts
 * @returns every caption and numbered equation on a page, in reading order.
 */
export function findCaptionLines(lines: readonly TextLine[], pageWidth: number, columnSplit: number | null): CaptionHit[] {
  const hits: CaptionHit[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line.text.trim();
    const label = CAPTION_LABEL.exec(text);
    const cap = label && CAPTION_REST.test(text.slice(label[0].length)) ? label : null;
    if (cap) {
      hits.push({ kind: floatKindOf(cap[1]!), label: cap[2]!.toLowerCase(), lineIndex });
      return;
    }
    const eq = EQUATION_TAIL.exec(text);
    if (eq) {
      // The number sits at the right edge of the TEXT block (not of the page, which has a margin), and the line is
      // mostly formula rather than a full line of prose that happens to end in "(5)".
      const [left, right] = columnBounds(line, pageWidth, columnSplit);
      const edge = textRightEdge(lines, left, right);
      const atRightEdge = line.xEnd >= edge - (edge - left) * 0.05;
      const startsIndented = line.x >= left + (edge - left) * 0.25;
      if (atRightEdge && startsIndented && text.length <= 90) {
        hits.push({ kind: "equation", label: eq[1]!.toLowerCase(), lineIndex });
      }
    }
  });
  return hits;
}

/** Rectangle in PDF user space (origin bottom-left): yTop > yBottom. */
export interface PdfRegion {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

// Right edge of the running text inside [left, right]: a high percentile, so one stray wide line does not define it.
function textRightEdge(lines: readonly TextLine[], left: number, right: number): number {
  const ends = lines.filter((l) => l.xEnd > left + 2 && l.x < right - 2).map((l) => l.xEnd).sort((a, b) => a - b);
  return ends[Math.floor((ends.length - 1) * 0.9)] ?? right;
}

function columnBounds(line: TextLine, pageWidth: number, columnSplit: number | null): [number, number] {
  if (columnSplit === null) { return [0, pageWidth]; }
  if (line.xEnd <= columnSplit + 6) { return [0, columnSplit]; }
  if (line.x >= columnSplit - 6) { return [columnSplit, pageWidth]; }
  // A caption straddling the gutter belongs to a float that spans both columns.
  return [0, pageWidth];
}

const MAX_CAPTION_LINES = 6;
const MAX_FLOAT_RATIO = 0.55;
const MIN_FLOAT_RATIO = 0.08;
const TABLE_RATIO = 0.4;
const EQUATION_PAD_RATIO = 0.07;

/**
 * Region to preview for a caption: the caption block plus the float it describes.
 * Tables sit below their caption by convention. A figure sits on whichever side of its caption has the larger band free
 * of body text (journals caption below the figure, ABNT theses above it); narrow lines inside that band are axis labels
 * and legends OCR picked up from the figure itself, so they do not end the band.
 * @usedBy pdf-viewer/webview/ui/floatResolver.ts
 * @returns the region in PDF user space, clamped to the page.
 */
export function floatRegion(
  lines: readonly TextLine[],
  hit: CaptionHit,
  pageWidth: number,
  pageHeight: number,
  columnSplit: number | null,
): PdfRegion {
  const cap = lines[hit.lineIndex]!;
  const [x0, x1] = columnBounds(cap, pageWidth, columnSplit);
  const clampY = (y: number): number => Math.min(pageHeight, Math.max(0, y));

  if (hit.kind === "equation") {
    const pad = pageHeight * EQUATION_PAD_RATIO;
    return { x0, x1, yTop: clampY(cap.y + cap.height + pad), yBottom: clampY(cap.y - pad) };
  }

  const inColumn = (l: TextLine): boolean => l.xEnd > x0 + 2 && l.x < x1 - 2;
  const isBodyText = (l: TextLine): boolean => (l.xEnd - l.x) >= (x1 - x0) * 0.3;

  // The caption block: its first line plus the lines that follow at normal line pitch.
  let last = hit.lineIndex;
  for (let i = hit.lineIndex + 1; i < lines.length && i - hit.lineIndex < MAX_CAPTION_LINES; i++) {
    const l = lines[i]!;
    const prev = lines[i - 1]!;
    if (l.column !== cap.column || prev.y - l.y > Math.max(prev.height, l.height) * 1.7 || prev.y - l.y <= 0) { break; }
    last = i;
  }
  const captionTop = cap.y + cap.height;
  const captionBottom = lines[last]!.y - lines[last]!.height * 0.35;

  if (hit.kind === "table") {
    // The body hangs below the caption. Follow its rows down and stop at the first clear break (the space before the
    // next paragraph, or the end of the text), so a table at the foot of a page is not shown above a void.
    // Rows are counted from the caption's first line: they follow it at ordinary line pitch, so the "caption block"
    // above would otherwise swallow the whole table.
    const floor = captionTop - pageHeight * TABLE_RATIO;
    const rows = lines
      .filter((l, i) => i !== hit.lineIndex && inColumn(l) && l.y < cap.y && l.y >= floor)
      .sort((p, q) => q.y - p.y);
    const gaps = rows.map((l, i) => (i === 0 ? cap.y : rows[i - 1]!.y) - l.y).filter((g) => g > 0).sort((p, q) => p - q);
    const typical = gaps[Math.floor((gaps.length - 1) / 2)] ?? 0;
    let bottom = cap.y - cap.height * 0.35;
    let previous = cap.y;
    for (const row of rows) {
      const gap = previous - row.y;
      if (typical > 0 && gap > typical * 2.8 && gap > pageHeight * 0.035) { break; }
      bottom = row.y - row.height * 1.8;
      previous = row.y;
    }
    // A caption with nothing recognisable under it (an image-only table in a scan): fall back to the fixed band.
    if (rows.length === 0) { bottom = floor; }
    return { x0, x1, yTop: clampY(captionTop + cap.height * 0.5), yBottom: clampY(Math.max(bottom, floor)) };
  }

  let above = pageHeight - captionTop;
  let below = captionBottom;
  for (let i = 0; i < lines.length; i++) {
    if (i >= hit.lineIndex && i <= last) { continue; }
    const l = lines[i]!;
    if (!inColumn(l) || !isBodyText(l)) { continue; }
    if (l.y >= captionTop) { above = Math.min(above, l.y - captionTop); }
    else if (l.y + l.height <= captionBottom) { below = Math.min(below, captionBottom - (l.y + l.height)); }
  }
  const maxBand = pageHeight * MAX_FLOAT_RATIO;
  const figureAbove = above >= below;
  const band = Math.min(figureAbove ? above : below, maxBand);
  if (band < pageHeight * MIN_FLOAT_RATIO) {
    // No clear float next to the caption (dense page, OCR noise): show the caption with context on both sides.
    const pad = pageHeight * 0.22;
    return { x0, x1, yTop: clampY(captionTop + pad), yBottom: clampY(captionBottom - pad) };
  }
  return figureAbove
    ? { x0, x1, yTop: clampY(captionTop + band), yBottom: clampY(captionBottom) }
    : { x0, x1, yTop: clampY(captionTop + cap.height * 0.4), yBottom: clampY(captionBottom - band) };
}

/**
 * Chooses the caption a reference points at: the exact label, else the label without its sub-figure letter ("3a" → "3").
 * @usedBy pdf-viewer/webview/ui/floatResolver.ts
 * @returns the index into `hits`, or -1.
 */
export function pickCaption(hits: ReadonlyArray<Pick<CaptionHit, "kind" | "label">>, kind: FloatKind, label: string): number {
  const wanted = label.toLowerCase();
  const exact = hits.findIndex((h) => h.kind === kind && h.label === wanted);
  if (exact >= 0) { return exact; }
  const numeric = wanted.replace(/[a-z]$/, "");
  return hits.findIndex((h) => h.kind === kind && h.label.replace(/[a-z]$/, "") === numeric);
}
