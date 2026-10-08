/**
 * Drawing primitives of the main screen: the column layout, list rows for collections and papers, styled preview
 * lines, the header breadcrumb and the status bar segments. Stateless; the App decides what to draw.
 *
 * @depends tui/screen, tui/text, ui/theme, ui/preview, library/libraryStore
 * @dependents ui/app
 */
import type { PaperEntry } from "../library/index.js";
import type { Screen, Style } from "../tui/screen.js";
import { mergeStyle } from "../tui/screen.js";
import { stringWidth, truncate } from "../tui/text.js";
import type { Line } from "./preview.js";
import { STATUS_GLYPH, theme } from "./theme.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  header: Rect;
  folders: Rect | undefined;
  papers: Rect | undefined;
  preview: Rect | undefined;
  status: Rect;
}

/**
 * Splits the screen into header, three panes — folders, papers, preview, like Zotero's panes laid out as yazi's
 * columns — and a status bar. Narrow terminals keep the focused list pane and the preview, then the focused pane only.
 * @usedBy ui/app
 * @returns the rectangles
 */
export function computeLayout(width: number, height: number, focus: "folders" | "papers" = "papers"): Layout {
  const bodyY = 1;
  const bodyH = Math.max(1, height - 2);
  const header = { x: 0, y: 0, w: width, h: 1 };
  const status = { x: 0, y: height - 1, w: width, h: 1 };
  const pane = (x: number, w: number): Rect => ({ x, y: bodyY, w, h: bodyH });
  if (width < 60) {
    const only = pane(0, width);
    return { header, folders: focus === "folders" ? only : undefined, papers: focus === "papers" ? only : undefined, preview: undefined, status };
  }
  if (width < 96) {
    const previewW = Math.floor(width * 0.42);
    const listW = width - previewW - 1;
    const list = pane(0, listW);
    return {
      header,
      folders: focus === "folders" ? list : undefined,
      papers: focus === "papers" ? list : undefined,
      preview: pane(listW + 1, previewW),
      status,
    };
  }
  const foldersW = Math.min(40, Math.max(18, Math.floor(width * 0.2)));
  const previewW = Math.floor((width - foldersW) * 0.45);
  const papersW = width - foldersW - previewW - 2;
  return {
    header,
    folders: pane(0, foldersW),
    papers: pane(foldersW + 1, papersW),
    preview: pane(foldersW + papersW + 2, previewW),
    status,
  };
}

/**
 * Draws the vertical separators between columns.
 * @usedBy ui/app
 * @returns void
 */
export function drawSeparators(screen: Screen, layout: Layout): void {
  for (const rect of [layout.papers, layout.preview]) {
    if (!rect || rect.x === 0) { continue; }
    for (let row = rect.y; row < rect.y + rect.h; row++) { screen.text(rect.x - 1, row, "│", theme.separator); }
  }
}

export interface RowMarks {
  hovered: boolean;
  /** The row is the pane's cursor but the other pane has focus. */
  dimHover?: boolean;
  selected: boolean;
  cut: boolean;
}

function rowBase(screen: Screen, x: number, y: number, width: number, marks: RowMarks): (style: Style | undefined) => Style {
  const hover = marks.hovered ? (marks.dimHover ? theme.hoverParent : theme.hover) : undefined;
  screen.fill(x, y, width, 1, hover);
  const mark = marks.cut || marks.selected ? "▌" : " ";
  screen.text(x, y, mark, marks.cut ? theme.cutMark : marks.selected ? theme.selectedMark : hover);
  return (style) => (hover ? mergeStyle(style, hover) : style ?? {});
}

export interface FolderRowData {
  label: string;
  depth: number;
  count: number;
  /** Pseudo rows (All papers, Unfiled) are drawn in the plain text color. */
  pseudo?: boolean;
}

/**
 * One row of the folders pane: indentation by depth, the folder name and its paper count.
 * @usedBy ui/app
 * @returns void
 */
export function drawFolderRow(screen: Screen, x: number, y: number, width: number, row: FolderRowData, marks: RowMarks): void {
  if (width <= 3) { return; }
  const base = rowBase(screen, x, y, width, marks);
  const count = String(row.count);
  const indent = Math.min(row.depth * 2, Math.max(0, width - 8));
  const nameWidth = Math.max(1, width - 1 - indent - count.length - 2);
  screen.text(x + 1 + indent, y, truncate(row.label, nameWidth), base(row.pseudo ? theme.bold : theme.collection));
  screen.text(x + width - count.length - 1, y, count, base(theme.count));
}

/**
 * One row of the papers pane: a mark cell (selected / cut), the status glyph, the title and the year. Papers without a
 * PDF on this device are drawn in italics.
 * @usedBy ui/app
 * @returns void
 */
export function drawPaperRow(screen: Screen, x: number, y: number, width: number, paper: PaperEntry, marks: RowMarks, detail?: string): void {
  if (width <= 4) { return; }
  const base = rowBase(screen, x, y, width, marks);
  const record = paper.record;
  const inner = width - 1;
  screen.text(x + 1, y, STATUS_GLYPH[record.status], base(theme.status[record.status]));
  const year = record.year ? String(record.year) : "";
  // The folder name is context, not content: capped so the title keeps most of the row.
  const shortDetail = detail ? truncate(detail, Math.max(6, Math.min(16, Math.floor(inner * 0.25)))) : undefined;
  const tail = shortDetail ? `${shortDetail}  ${year}` : year;
  const tailWidth = inner > 30 ? stringWidth(tail) : inner > 12 ? year.length : 0;
  const titleWidth = Math.max(1, inner - 2 - (tailWidth ? tailWidth + 2 : 1));
  screen.text(x + 3, y, truncate(record.title, titleWidth), base(record.hasPdf === false ? theme.noPdf : theme.text));
  if (tailWidth) {
    const shown = inner > 30 ? tail : year;
    screen.text(x + width - stringWidth(shown) - 1, y, shown, base(theme.year));
  }
}

/**
 * Draws styled lines into a rectangle, starting at line `scroll`.
 * @usedBy ui/app
 * @returns the number of rows drawn
 */
export function drawLines(screen: Screen, rect: Rect, lines: Line[], scroll = 0): number {
  let row = 0;
  for (let i = scroll; i < lines.length && row < rect.h; i++, row++) {
    let col = rect.x;
    for (const segment of lines[i]!) {
      const room = rect.x + rect.w - col;
      if (room <= 0) { break; }
      const text = stringWidth(segment.text) > room ? truncate(segment.text, room) : segment.text;
      col += screen.text(col, rect.y + row, text, segment.style, room);
    }
  }
  return row;
}

/**
 * Lays segments left to right in one row, each separated by a space, stopping at the edge.
 * @usedBy ui/app (header, status bar)
 * @returns the column after the last segment
 */
export function drawSegments(screen: Screen, x: number, y: number, maxX: number, segments: Array<{ text: string; style?: Style }>): number {
  let col = x;
  for (const segment of segments) {
    if (!segment.text) { continue; }
    if (col >= maxX) { break; }
    col += screen.text(col, y, segment.text, segment.style, maxX - col);
  }
  return col;
}
