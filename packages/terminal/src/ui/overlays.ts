/**
 * Overlays drawn above the three columns — prompts, confirmations, fuzzy pickers and the help screen — and the
 * bottom-line input used by filter, find and library search. State types live here with their drawing code; the
 * App owns the instances and decides what happens on submit.
 *
 * @depends tui/screen, tui/text, ui/textInput, ui/keymap, ui/theme
 * @dependents ui/app, ui/render
 */
import type { Screen, Style } from "../tui/screen.js";
import { fit, stringWidth, truncate, wrap } from "../tui/text.js";
import { BINDINGS, keyLabel, type BindingGroup } from "./keymap.js";
import type { TextInputState } from "./textInput.js";
import { theme } from "./theme.js";

export type PromptPurpose = "add" | "tags" | "tagsBatch" | "rename" | "command" | "export";

export interface PromptOverlay {
  kind: "prompt";
  purpose: PromptPurpose;
  title: string;
  hint?: string;
  input: TextInputState;
  /** Completion candidates shown under the field (Tab cycles/accepts). */
  completions: string[];
  /** Paper ids or collection path the prompt acts on. */
  targets: string[];
}

export interface ConfirmOverlay {
  kind: "confirm";
  title: string;
  lines: string[];
  onYes: () => void;
}

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

export interface PickerOverlay {
  kind: "picker";
  title: string;
  input: TextInputState;
  items: PickerItem[];
  filtered: PickerItem[];
  index: number;
  onPick: (item: PickerItem) => void;
}

export interface HelpOverlay {
  kind: "help";
  scroll: number;
}

export type Overlay = PromptOverlay | ConfirmOverlay | PickerOverlay | HelpOverlay;

export type InlinePurpose = "filter" | "find" | "search";

/** The bottom-line input of filter (f), find (/) and search (s); results update as the user types. */
export interface InlineInput {
  purpose: InlinePurpose;
  input: TextInputState;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draws a rounded box with a title and clears its inside.
 * @usedBy drawOverlay
 * @returns the inner area
 */
export function drawBox(screen: Screen, box: Box, title: string): Box {
  const { x, y, w, h } = box;
  screen.fill(x, y, w, h, theme.text);
  const border = theme.popupBorder;
  screen.text(x, y, "╭" + "─".repeat(Math.max(0, w - 2)) + "╮", border);
  for (let row = y + 1; row < y + h - 1; row++) {
    screen.text(x, row, "│", border);
    screen.text(x + w - 1, row, "│", border);
  }
  screen.text(x, y + h - 1, "╰" + "─".repeat(Math.max(0, w - 2)) + "╯", border);
  if (title) { screen.text(x + 2, y, ` ${truncate(title, w - 6)} `, theme.popupTitle); }
  return { x: x + 2, y: y + 1, w: w - 4, h: h - 2 };
}

/**
 * Draws a text field with a block cursor, scrolled so the cursor stays visible.
 * @usedBy drawOverlay, ui/render (inline input)
 * @returns void
 */
export function drawField(screen: Screen, x: number, y: number, width: number, state: TextInputState, style: Style = theme.text): void {
  const before = state.value.slice(0, state.cursor);
  // The cell under the cursor is a whole code point, never half of a surrogate pair.
  const cp = state.value.codePointAt(state.cursor);
  const at = cp === undefined ? " " : String.fromCodePoint(cp);
  const after = state.value.slice(state.cursor + (cp === undefined ? 0 : at.length));
  let shown = before;
  // Keep the cursor inside the field by dropping text on the left.
  while (stringWidth(shown) > width - 2 && shown.length) { shown = shown.slice(1); }
  let col = x + screen.text(x, y, shown, style, width);
  col += screen.text(col, y, at, { ...style, reverse: true }, x + width - col);
  screen.text(col, y, after, style, x + width - col);
}

function centered(screen: Screen, w: number, h: number): Box {
  const width = Math.min(w, screen.width - 2);
  const height = Math.min(h, screen.height - 2);
  return { x: Math.max(0, Math.floor((screen.width - width) / 2)), y: Math.max(0, Math.floor((screen.height - height) / 3)), w: width, h: height };
}

/**
 * Draws whichever overlay is open.
 * @usedBy ui/render
 * @returns void
 */
export function drawOverlay(screen: Screen, overlay: Overlay): void {
  switch (overlay.kind) {
    case "prompt": return drawPrompt(screen, overlay);
    case "confirm": return drawConfirm(screen, overlay);
    case "picker": return drawPicker(screen, overlay);
    case "help": return drawHelp(screen, overlay);
  }
}

function drawPrompt(screen: Screen, prompt: PromptOverlay): void {
  const shownCompletions = prompt.completions.slice(0, 8);
  const box = centered(screen, 74, 3);
  // Hints wrap rather than get cut: they advertise what the prompt accepts.
  const hintLines = prompt.hint ? wrap(prompt.hint, Math.max(10, box.w - 4)).slice(0, 4) : [];
  const extra = hintLines.length + (shownCompletions.length ? shownCompletions.length + 1 : 0);
  const inner = drawBox(screen, centered(screen, 74, 3 + extra), prompt.title);
  drawField(screen, inner.x, inner.y, inner.w, prompt.input);
  let row = inner.y + 1;
  for (const line of hintLines) { screen.text(inner.x, row++, truncate(line, inner.w), theme.dim); }
  if (shownCompletions.length) {
    row++;
    for (const completion of shownCompletions) { screen.text(inner.x, row++, truncate(completion, inner.w), theme.dim); }
  }
}

function drawConfirm(screen: Screen, confirm: ConfirmOverlay): void {
  const width = Math.max(40, ...confirm.lines.map((l) => stringWidth(l) + 6));
  const inner = drawBox(screen, centered(screen, Math.min(width, 80), confirm.lines.length + 4), confirm.title);
  confirm.lines.forEach((line, i) => screen.text(inner.x, inner.y + i, truncate(line, inner.w)));
  const row = inner.y + confirm.lines.length + 1;
  let col = inner.x;
  col += screen.text(col, row, "y", theme.key);
  col += screen.text(col, row, " confirm   ", theme.dim);
  col += screen.text(col, row, "n", theme.key);
  screen.text(col, row, " / Esc cancel", theme.dim);
}

function drawPicker(screen: Screen, picker: PickerOverlay): void {
  const rows = Math.min(16, Math.max(3, screen.height - 8));
  const inner = drawBox(screen, centered(screen, 90, rows + 4), `${picker.title} (${picker.filtered.length})`);
  drawField(screen, inner.x, inner.y, inner.w, picker.input);
  const listTop = inner.y + 2;
  const visible = inner.h - 2;
  const offset = Math.max(0, Math.min(picker.index - Math.floor(visible / 2), picker.filtered.length - visible));
  for (let i = 0; i < visible; i++) {
    const item = picker.filtered[offset + i];
    if (!item) { break; }
    const hovered = offset + i === picker.index;
    const style = hovered ? theme.hover : theme.text;
    const detail = item.detail ? `  ${item.detail}` : "";
    const labelWidth = Math.max(10, inner.w - stringWidth(detail));
    screen.text(inner.x, listTop + i, fit(item.label, labelWidth), style);
    if (detail) { screen.text(inner.x + labelWidth, listTop + i, truncate(detail, inner.w - labelWidth), hovered ? theme.hover : theme.dim); }
  }
  if (!picker.filtered.length) { screen.text(inner.x, listTop, "No match", theme.dim); }
}

const HELP_GROUPS: BindingGroup[] = ["Navigate", "Find", "Select", "Papers", "Copy", "Sort", "App"];

/**
 * The help screen's lines, generated from the keymap.
 * @usedBy drawHelp, tests
 * @returns [keys, description, isHeader] rows
 */
export function helpRows(): Array<{ keys: string; desc: string; header?: boolean }> {
  const rows: Array<{ keys: string; desc: string; header?: boolean }> = [];
  for (const group of HELP_GROUPS) {
    rows.push({ keys: group, desc: "", header: true });
    for (const binding of BINDINGS) {
      if (binding.group === group && !binding.alias) { rows.push({ keys: keyLabel(binding.keys), desc: binding.desc }); }
    }
    rows.push({ keys: "", desc: "" });
  }
  rows.push({ keys: "Query", desc: "", header: true });
  for (const [keys, desc] of [
    ["word \"a phrase\"", "every word must match; -word excludes"],
    ["tag:nlp  #nlp", "has a tag"],
    ["status:reading  is:r", "unread, reading, done"],
    ["year:2015..2020", "publication year; also year:2017, >2018, <2000"],
    ["author:vaswani", "author"],
    ["has:pdf  no:pdf", "also has:note, has:doi, has:tags"],
  ] as const) {
    rows.push({ keys, desc });
  }
  return rows;
}

function drawHelp(screen: Screen, help: HelpOverlay): void {
  const inner = drawBox(screen, centered(screen, 96, screen.height - 2), "LabShelf keys — j/k scroll, Esc close");
  const rows = helpRows();
  const keyWidth = 22;
  const start = Math.min(help.scroll, Math.max(0, rows.length - inner.h));
  for (let i = 0; i < inner.h; i++) {
    const row = rows[start + i];
    if (!row) { break; }
    if (row.header) {
      screen.text(inner.x, inner.y + i, row.keys, theme.popupTitle);
      continue;
    }
    screen.text(inner.x, inner.y + i, fit(row.keys, keyWidth), theme.key);
    screen.text(inner.x + keyWidth, inner.y + i, truncate(row.desc, inner.w - keyWidth));
  }
}
