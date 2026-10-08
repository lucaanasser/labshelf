/**
 * Display-width aware text helpers: how many terminal cells a string takes, and truncating, padding and wrapping by
 * cells rather than by UTF-16 units. Paper titles carry accents, CJK names and the odd ligature, so counting
 * characters would misalign every column.
 *
 * @depends none
 * @dependents tui/screen, ui/* views
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// East Asian Wide / Fullwidth blocks and the emoji planes that terminals draw two cells wide.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4],
  [0x17000, 0x18cff], [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

// True for C0/C1 control characters, which must never reach the terminal raw: a crafted title could otherwise carry
// escape sequences that reprogram it.
function isControl(cp: number): boolean {
  return cp < 0x20 || (cp >= 0x7f && cp < 0xa0);
}

function isWide(cp: number): boolean {
  let lo = 0;
  let hi = WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = WIDE_RANGES[mid]!;
    if (cp < start) { hi = mid - 1; } else if (cp > end) { lo = mid + 1; } else { return true; }
  }
  return false;
}

/**
 * Cells taken by one grapheme cluster: 0 for marks and format characters, 2 for wide characters, 1 otherwise.
 * @usedBy stringWidth, graphemes, tui/screen
 * @returns 0, 1 or 2
 */
export function graphemeWidth(grapheme: string): 0 | 1 | 2 {
  const cp = grapheme.codePointAt(0) ?? 0;
  if (cp < 0x7f && cp >= 0x20) { return 1; }
  if (isControl(cp)) { return 0; }
  if (grapheme.length === 1 && ZERO_WIDTH.test(grapheme)) { return 0; }
  // An emoji presentation selector turns a narrow symbol into a two-cell emoji.
  if (isWide(cp) || grapheme.includes("️")) { return 2; }
  return 1;
}

/**
 * Splits text into grapheme clusters with their widths, replacing control characters with a visible placeholder.
 * @usedBy tui/screen, truncate, wrap
 * @returns the clusters in order
 */
export function graphemes(text: string): Array<{ g: string; w: 0 | 1 | 2 }> {
  const out: Array<{ g: string; w: 0 | 1 | 2 }> = [];
  if (/^[\x20-\x7e]*$/.test(text)) {
    for (const ch of text) { out.push({ g: ch, w: 1 }); }
    return out;
  }
  for (const { segment } of segmenter.segment(text)) {
    const cp = segment.codePointAt(0) ?? 0;
    if (isControl(cp)) {
      out.push({ g: cp === 0x09 ? " " : "�", w: 1 });
      continue;
    }
    out.push({ g: segment, w: graphemeWidth(segment) });
  }
  return out;
}

/**
 * @usedBy truncate, padEnd, ui views
 * @returns the number of terminal cells the text takes
 */
export function stringWidth(text: string): number {
  if (/^[\x20-\x7e]*$/.test(text)) { return text.length; }
  let width = 0;
  for (const { w } of graphemes(text)) { width += w; }
  return width;
}

/**
 * Cuts text to at most `width` cells, ending with an ellipsis when something was cut.
 * @usedBy ui views
 * @returns the truncated text
 */
export function truncate(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) { return ""; }
  if (stringWidth(text) <= width) { return text; }
  const room = width - stringWidth(ellipsis);
  if (room <= 0) { return ellipsis.slice(0, width); }
  let used = 0;
  let out = "";
  for (const { g, w } of graphemes(text)) {
    if (used + w > room) { break; }
    out += g;
    used += w;
  }
  return out + ellipsis;
}

/**
 * Pads (or truncates) text to exactly `width` cells.
 * @usedBy ui views
 * @returns the padded text
 */
export function fit(text: string, width: number): string {
  const cut = truncate(text, width);
  return cut + " ".repeat(Math.max(0, width - stringWidth(cut)));
}

/**
 * Word-wraps text into lines of at most `width` cells; words longer than a line are broken. Newlines are kept.
 * @usedBy ui/preview
 * @returns the wrapped lines
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) { return []; }
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = stringWidth(word);
      const sep = line ? 1 : 0;
      if (lineWidth + sep + wordWidth <= width) {
        line += (sep ? " " : "") + word;
        lineWidth += sep + wordWidth;
        continue;
      }
      if (line) { lines.push(line); }
      if (wordWidth <= width) {
        line = word;
        lineWidth = wordWidth;
        continue;
      }
      // Hard-break a word wider than the line.
      line = "";
      lineWidth = 0;
      for (const { g, w } of graphemes(word)) {
        if (lineWidth + w > width && line) {
          lines.push(line);
          line = "";
          lineWidth = 0;
        }
        line += g;
        lineWidth += w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Replaces control characters (except newline and tab) with U+FFFD, for text printed straight to a terminal: titles
 * and notes come from PDFs and other devices and could otherwise carry escape sequences (OSC 52 clipboard writes,
 * cursor moves, window titles).
 * @usedBy main (CLI output)
 * @returns the safe text
 */
export function sanitizeForTerminal(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "\uFFFD");
}

/**
 * Removes diacritics and case so "Schrödinger" matches "schrodinger".
 * @usedBy library/search, ui/fuzzy
 * @returns the folded text
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}
