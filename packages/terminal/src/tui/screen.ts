/**
 * A grid of styled cells that views draw into, and the diff that turns two frames into the shortest ANSI output.
 * Rendering always builds a whole new frame; only the cells that changed since the previous frame reach the terminal,
 * which keeps redraws flicker-free even over SSH.
 *
 * @depends tui/text
 * @dependents tui/terminal, ui/*
 */
import { graphemes } from "./text.js";

/** 0–255 palette index (0–15 follow the user's terminal theme), "#rrggbb", or undefined for the default color. */
export type Color = number | `#${string}`;

export interface Style {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

const styleTable: Style[] = [{}];
const styleIds = new Map<string, number>([["{}", 0]]);

/**
 * Interns a style so cells store a small integer instead of an object.
 * @usedBy Screen.text, Screen.fill
 * @returns the style id
 */
export function styleId(style: Style | undefined): number {
  if (!style || Object.values(style).every((v) => v === undefined || v === false)) { return 0; }
  const key = JSON.stringify([style.fg, style.bg, !!style.bold, !!style.dim, !!style.italic, !!style.underline, !!style.reverse]);
  let id = styleIds.get(key);
  if (id === undefined) {
    id = styleTable.length;
    styleTable.push({ ...style });
    styleIds.set(key, id);
  }
  return id;
}

/**
 * Merges two styles, the second winning.
 * @usedBy ui views
 * @returns the merged style
 */
export function mergeStyle(base: Style | undefined, over: Style | undefined): Style {
  return { ...(base ?? {}), ...(over ?? {}) };
}

function colorCode(color: Color, background: boolean): string {
  if (typeof color === "string") {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `${background ? 48 : 38};2;${r};${g};${b}`;
  }
  if (color < 8) { return String((background ? 40 : 30) + color); }
  if (color < 16) { return String((background ? 100 : 90) + color - 8); }
  return `${background ? 48 : 38};5;${color}`;
}

/**
 * The SGR sequence selecting a style from a reset state.
 * @usedBy Screen.diff
 * @returns the escape sequence
 */
export function sgr(id: number): string {
  const style = styleTable[id] ?? {};
  let code = "\x1b[0";
  if (style.bold) { code += ";1"; }
  if (style.dim) { code += ";2"; }
  if (style.italic) { code += ";3"; }
  if (style.underline) { code += ";4"; }
  if (style.reverse) { code += ";7"; }
  if (style.fg !== undefined) { code += ";" + colorCode(style.fg, false); }
  if (style.bg !== undefined) { code += ";" + colorCode(style.bg, true); }
  return code + "m";
}

/** One frame. Cells hold a grapheme ("" marks the right half of a wide character), its width and a style id. */
export class Screen {
  private readonly chars: string[];
  private readonly widths: Uint8Array;
  private readonly styles: Uint32Array;

  constructor(readonly width: number, readonly height: number) {
    const size = Math.max(0, width * height);
    this.chars = new Array<string>(size).fill(" ");
    this.widths = new Uint8Array(size).fill(1);
    this.styles = new Uint32Array(size);
  }

  private setCell(x: number, y: number, ch: string, w: number, style: number): void {
    const i = y * this.width + x;
    // Overwriting half of a wide character leaves the other half as a blank, not as a broken glyph.
    if (this.chars[i] === "" && x > 0) {
      this.chars[i - 1] = " ";
      this.widths[i - 1] = 1;
    }
    if (this.widths[i] === 2 && w !== 2 && x + 1 < this.width) {
      this.chars[i + 1] = " ";
      this.widths[i + 1] = 1;
    }
    this.chars[i] = ch;
    this.widths[i] = w;
    this.styles[i] = style;
    if (w === 2) {
      // The cell taken over may itself start another wide character: blank its right half.
      if (this.widths[i + 1] === 2 && x + 2 < this.width) {
        this.chars[i + 2] = " ";
        this.widths[i + 2] = 1;
      }
      this.chars[i + 1] = "";
      this.widths[i + 1] = 0;
      this.styles[i + 1] = style;
    }
  }

  /**
   * Draws text at (x, y), clipped to maxWidth cells and to the screen edge.
   * @usedBy ui views
   * @returns the number of cells written
   */
  text(x: number, y: number, text: string, style?: Style, maxWidth = Infinity): number {
    if (y < 0 || y >= this.height || x >= this.width) { return 0; }
    const id = styleId(style);
    const limit = Math.min(this.width, x + maxWidth);
    let col = x;
    for (const { g, w } of graphemes(text)) {
      if (w === 0) { continue; }
      if (col + w > limit) {
        // A wide character that does not fit leaves a blank instead of spilling over.
        if (col < limit && col >= 0) { this.setCell(col, y, " ", 1, id); col++; }
        break;
      }
      if (col >= 0) { this.setCell(col, y, g, w, id); }
      col += w;
    }
    return Math.max(0, col - x);
  }

  /**
   * Fills a rectangle with one character and style.
   * @usedBy ui views
   * @returns void
   */
  fill(x: number, y: number, w: number, h: number, style?: Style, ch = " "): void {
    const id = styleId(style);
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) { this.setCell(col, row, ch, 1, id); }
    }
  }

  /**
   * The plain text of one row, wide characters included once; used by tests and the --dump-frame debug flag.
   * @usedBy tests, main
   * @returns the row text
   */
  rowText(y: number): string {
    let out = "";
    for (let x = 0; x < this.width; x++) { out += this.chars[y * this.width + x] ?? ""; }
    return out;
  }

  /**
   * @usedBy tests, main
   * @returns every row joined by newlines, with trailing spaces trimmed
   */
  toText(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) { rows.push(this.rowText(y).trimEnd()); }
    return rows.join("\n");
  }

  /**
   * The style of one cell, for tests.
   * @usedBy tests
   * @returns the style
   */
  styleAt(x: number, y: number): Style {
    return styleTable[this.styles[y * this.width + x] ?? 0] ?? {};
  }

  /**
   * ANSI output that turns `previous` into this frame; without a previous frame (or after a resize) every cell is
   * written.
   * @usedBy tui/terminal render loop
   * @returns the escape sequence string
   */
  diff(previous: Screen | undefined): string {
    const full = !previous || previous.width !== this.width || previous.height !== this.height;
    let out = "";
    let pen = -1;
    let cursorX = -1;
    let cursorY = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        const ch = this.chars[i]!;
        if (ch === "") { continue; }
        const style = this.styles[i]!;
        const width = this.widths[i]!;
        if (!full) {
          const same = previous!.chars[i] === ch && previous!.styles[i] === style
            && (width !== 2 || (previous!.chars[i + 1] === "" && previous!.styles[i + 1] === style));
          if (same) { continue; }
        }
        if (cursorX !== x || cursorY !== y) {
          out += `\x1b[${y + 1};${x + 1}H`;
        }
        if (pen !== style) {
          out += sgr(style);
          pen = style;
        }
        out += ch;
        cursorX = x + width;
        cursorY = y;
      }
    }
    return out ? out + "\x1b[0m" : "";
  }
}
