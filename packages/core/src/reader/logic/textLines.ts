/**
 * Rebuilds reading-order text lines from pdf.js text items, aware of two-column layouts, sideways margin stamps and
 * the OCR debris they leave behind.
 */

/** A pdf.js TextItem reduced to geometry: x/y are `transform[4]`/`transform[5]` (PDF space, origin bottom-left). */
export interface TextItemBox {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Quarter turn the run is set at, from `runOrientation`; absent means upright. */
  orientation?: number;
}

export interface TextLine {
  text: string;
  x: number;
  xEnd: number;
  /** Baseline, PDF space. */
  y: number;
  height: number;
  /** 0 for single-column pages and the left column; 1 for the right column. */
  column: number;
}

const BINS = 100;

/**
 * @param transform pdf.js text transform `[a, b, c, d, e, f]`.
 * @returns the quarter turn a run is set at: 0 upright, 1 reading bottom-to-top, 2 upside down, 3 reading top-to-bottom.
 */
export function runOrientation(transform: readonly number[]): number {
  const a = transform[0] ?? 1;
  const b = transform[1] ?? 0;
  if (Math.abs(a) >= Math.abs(b)) { return a >= 0 ? 0 : 2; }
  return b > 0 ? 1 : 3;
}

const MIN_WORDS_FOR_MARGINS = 20;
const DEBRIS_MAX_CHARS = 3;
// "[1]", "(12)", "3.", "a)": hanging list and reference markers legitimately sit left of the text block.
const MARKER_SHAPED = /^(?:[[(]\s*[\p{L}\d]{1,3}\s*[\])]?|[\p{L}\d]{1,3}[.)\]])$/u;

/**
 * Removes what is on the page but not part of its running text, before lines are rebuilt:
 *  - runs set sideways, such as the "Downloaded from … subject to license" stamp publishers print up the margin. Read
 *    as horizontal they are hundreds of points wide and swallow whichever line shares their y. The page's dominant
 *    orientation is kept, so a page drawn entirely sideways still yields its text;
 *  - the debris OCR makes of such a stamp: one- to three-character tokens ("&", "5", "[=") stranded in the outer
 *    margin. Glued to the start of each line they defeat every line-anchored test downstream — "& REFERENCES" is not
 *    a heading, "5 [1] A. Author" not a numbered entry, "p FIG. 1. An example" not a caption.
 * @returns the items that belong to the page's running text, in their original order.
 */
export function readableItems(items: readonly TextItemBox[], pageWidth: number): TextItemBox[] {
  const mass = [0, 0, 0, 0];
  for (const it of items) { mass[it.orientation ?? 0]! += it.str.trim().length; }
  const dominant = mass.indexOf(Math.max(...mass));
  const upright = items.filter((it) => (it.orientation ?? 0) === dominant);

  const words = upright.filter((it) => it.str.trim().length > DEBRIS_MAX_CHARS && it.width > 0);
  if (words.length < MIN_WORDS_FOR_MARGINS || !(pageWidth > 0)) { return upright; }
  // Percentiles, not extremes: a stray long token in the margin must not move the text block's edge.
  const lefts = words.map((w) => w.x).sort((p, q) => p - q);
  const rights = words.map((w) => w.x + w.width).sort((p, q) => p - q);
  const bodyLeft = lefts[Math.floor((lefts.length - 1) * 0.05)]!;
  const bodyRight = rights[Math.floor((rights.length - 1) * 0.95)]!;
  return upright.filter((it) => {
    const text = it.str.trim();
    if (text.length === 0 || text.length > DEBRIS_MAX_CHARS || MARKER_SHAPED.test(text)) { return true; }
    const clearance = it.height * 2;
    return it.x + it.width >= bodyLeft - clearance && it.x <= bodyRight + clearance;
  });
}

/**
 * Looks for an empty vertical gutter near the middle of the page.
 * @returns the x that splits the two columns, or null for a single-column page.
 */
export function detectColumns(items: readonly TextItemBox[], pageWidth: number): number | null {
  const real = items.filter((i) => i.str.trim().length > 0 && i.width > 0);
  if (real.length < 20 || !(pageWidth > 0)) { return null; }
  const cover = new Array<number>(BINS).fill(0);
  for (const it of real) {
    const from = Math.max(0, Math.floor((it.x / pageWidth) * BINS));
    const to = Math.min(BINS - 1, Math.floor(((it.x + it.width) / pageWidth) * BINS));
    for (let b = from; b <= to; b++) { cover[b]! += 1; }
  }
  const peak = Math.max(...cover);
  let gutter = -1;
  let gutterCover = Infinity;
  for (let b = 35; b <= 65; b++) {
    if (cover[b]! < gutterCover) { gutterCover = cover[b]!; gutter = b; }
  }
  if (gutter < 0 || gutterCover > peak * 0.05) { return null; }
  const leftMass = cover.slice(0, gutter).reduce((a, c) => a + c, 0);
  const rightMass = cover.slice(gutter + 1).reduce((a, c) => a + c, 0);
  // A lone left column with a wide margin is not a two-column page.
  if (Math.min(leftMass, rightMass) < Math.max(leftMass, rightMass) * 0.25) { return null; }
  return ((gutter + 0.5) / BINS) * pageWidth;
}

function joinLine(parts: TextItemBox[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const p of parts) {
    if (prevEnd !== null) {
      const gap = p.x - prevEnd;
      const needsSpace = gap > p.height * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ");
      if (needsSpace) { out += " "; }
    }
    out += p.str;
    prevEnd = p.x + p.width;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * @returns lines in reading order: left column top-to-bottom, then right column.
 */
export function groupItemsIntoLines(items: readonly TextItemBox[], pageWidth: number): TextLine[] {
  const split = detectColumns(items, pageWidth);
  const columns: TextItemBox[][] = [[], []];
  for (const it of items) {
    if (it.str.trim().length === 0) { continue; }
    const col = split !== null && it.x + it.width / 2 > split ? 1 : 0;
    columns[col]!.push(it);
  }
  const lines: TextLine[] = [];
  columns.forEach((colItems, column) => {
    const sorted = [...colItems].sort((a, b) => b.y - a.y || a.x - b.x);
    let bucket: TextItemBox[] = [];
    const flush = (): void => {
      if (bucket.length === 0) { return; }
      const parts = [...bucket].sort((a, b) => a.x - b.x);
      const first = parts[0]!;
      const last = parts[parts.length - 1]!;
      const text = joinLine(parts);
      if (text) {
        lines.push({
          text,
          x: first.x,
          xEnd: last.x + last.width,
          y: first.y,
          height: Math.max(...parts.map((p) => p.height)),
          column,
        });
      }
      bucket = [];
    };
    for (const it of sorted) {
      const ref = bucket[0];
      if (ref && Math.abs(ref.y - it.y) > Math.max(ref.height, it.height, 1) * 0.5) { flush(); }
      bucket.push(it);
    }
    flush();
  });
  return lines;
}
