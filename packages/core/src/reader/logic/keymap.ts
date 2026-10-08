/**
 * Pure keyboard-binding resolution for the reader: a conventional table that is always active and a vim layer gated by `labshelf.reader.vimKeys`.
 * DOM-free so jest (node env) can cover it; ui/keyboard.ts adapts KeyboardEvent into KeyInput.
 */

export type ReaderAction =
  | "scrollDown" | "scrollUp" | "scrollLeft" | "scrollRight"
  | "pageDown" | "pageUp" | "halfPageDown" | "halfPageUp"
  | "nextPage" | "prevPage" | "firstPage" | "lastPage"
  | "find" | "findNext" | "findPrev"
  | "zoomIn" | "zoomOut" | "zoomReset" | "fitWidth" | "fitPage"
  | "historyBack" | "historyForward"
  | "goToPage" | "toggleSidebar" | "cheatsheet" | "copyWithCitation" | "escape";

export interface KeyInput {
  key: string;
  /** KeyboardEvent.code, when available. */
  code?: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyContext {
  vimKeys: boolean;
  isMac: boolean;
  /** Focus is in an input/textarea/contenteditable: only modified chords, function keys and Escape may fire. */
  inTextInput: boolean;
  /** First key of a pending vim chord ("g" while waiting for the second "g"). */
  pendingPrefix: string | null;
}

export interface KeyResolution {
  action: ReaderAction | null;
  /** Prefix the caller must remember (and expire after CHORD_TIMEOUT_MS) for the next keydown. */
  pendingPrefix: string | null;
}

export const CHORD_TIMEOUT_MS = 800;

/**
 * Alt/Option+Arrow moves the caret by word inside a text field; navigating the reading history from there would
 * throw the page away mid-typing. Applies to keydown resolution and to the same chord delivered by a host keybinding.
 */
export const ACTIONS_BLOCKED_WHILE_TYPING: ReadonlySet<ReaderAction> = new Set<ReaderAction>(["historyBack", "historyForward"]);

interface Binding {
  key: string;
  action: ReaderAction;
  /** Platform primary modifier: Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  alt?: boolean;
  /** undefined = irrelevant (the shifted character is already in `key`, e.g. "?" or "N"). */
  shift?: boolean;
  macOnly?: boolean;
  label: string;
  group: "Navigate" | "Search" | "Zoom" | "View";
}

const CONVENTIONAL: readonly Binding[] = [
  { key: "ArrowDown", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "ArrowUp", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "ArrowRight", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "ArrowLeft", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "PageDown", action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: " ", shift: false, action: "pageDown", label: "Scroll one screen down", group: "Navigate" },
  { key: "PageUp", action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: " ", shift: true, action: "pageUp", label: "Scroll one screen up", group: "Navigate" },
  { key: "Home", action: "firstPage", label: "First page", group: "Navigate" },
  { key: "End", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: "g", mod: true, alt: true, action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "ArrowLeft", alt: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "ArrowRight", alt: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "[", mod: true, macOnly: true, action: "historyBack", label: "Back", group: "Navigate" },
  { key: "]", mod: true, macOnly: true, action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "f", mod: true, action: "find", label: "Find in document", group: "Search" },
  { key: "g", mod: true, shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "g", mod: true, shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "F3", shift: false, action: "findNext", label: "Next match", group: "Search" },
  { key: "F3", shift: true, action: "findPrev", label: "Previous match", group: "Search" },
  { key: "=", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "+", mod: true, action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", mod: true, action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "0", mod: true, action: "zoomReset", label: "Reset zoom to default", group: "Zoom" },
  { key: "F4", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
  { key: "c", mod: true, shift: true, action: "copyWithCitation", label: "Copy selection with citation", group: "View" },
  { key: "?", action: "cheatsheet", label: "Keyboard shortcuts", group: "View" },
  { key: "Escape", action: "escape", label: "Close find / popups", group: "View" },
];

const VIM: readonly Binding[] = [
  { key: "j", action: "scrollDown", label: "Scroll down", group: "Navigate" },
  { key: "k", action: "scrollUp", label: "Scroll up", group: "Navigate" },
  { key: "h", action: "scrollLeft", label: "Scroll left", group: "Navigate" },
  { key: "l", action: "scrollRight", label: "Scroll right", group: "Navigate" },
  { key: "d", action: "halfPageDown", label: "Half screen down", group: "Navigate" },
  { key: "u", action: "halfPageUp", label: "Half screen up", group: "Navigate" },
  { key: "J", action: "nextPage", label: "Next page", group: "Navigate" },
  { key: "K", action: "prevPage", label: "Previous page", group: "Navigate" },
  { key: "G", action: "lastPage", label: "Last page", group: "Navigate" },
  { key: ":", action: "goToPage", label: "Go to page", group: "Navigate" },
  { key: "H", action: "historyBack", label: "Back", group: "Navigate" },
  { key: "L", action: "historyForward", label: "Forward", group: "Navigate" },
  { key: "/", action: "find", label: "Find in document", group: "Search" },
  { key: "n", action: "findNext", label: "Next match", group: "Search" },
  { key: "N", action: "findPrev", label: "Previous match", group: "Search" },
  { key: "+", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "=", action: "zoomIn", label: "Zoom in", group: "Zoom" },
  { key: "-", action: "zoomOut", label: "Zoom out", group: "Zoom" },
  { key: "w", action: "fitWidth", label: "Fit width", group: "Zoom" },
  { key: "e", action: "fitPage", label: "Fit page", group: "Zoom" },
  { key: "t", action: "toggleSidebar", label: "Toggle sidebar", group: "View" },
];

function primaryMod(input: KeyInput, isMac: boolean): boolean {
  return isMac ? input.meta && !input.ctrl : input.ctrl && !input.meta;
}

function matches(b: Binding, input: KeyInput, isMac: boolean): boolean {
  if (b.macOnly && !isMac) { return false; }
  const wantMod = b.mod === true;
  if (wantMod !== primaryMod(input, isMac)) { return false; }
  // A stray non-primary modifier (Ctrl on macOS, Cmd elsewhere) belongs to some other chord.
  if (!wantMod && (input.ctrl || input.meta)) { return false; }
  if ((b.alt === true) !== input.alt) { return false; }
  if (b.shift !== undefined && b.shift !== input.shift) { return false; }
  // macOS rewrites `key` for Option+letter ("©" for Option+G), so Alt letter chords match on the physical key.
  if (b.alt && b.key.length === 1 && input.code) { return input.code === `Key${b.key.toUpperCase()}`; }
  // Modified letters arrive upper- or lower-cased depending on Shift; bare keys stay case-sensitive (n vs N).
  return wantMod ? b.key.toLowerCase() === input.key.toLowerCase() : b.key === input.key;
}

/**
 * Resolves one keydown into a reader action.
 * @returns the action (or null) and the chord prefix to carry into the next keydown.
 */
export function resolveKey(input: KeyInput, ctx: KeyContext): KeyResolution {
  const none: KeyResolution = { action: null, pendingPrefix: null };
  const bare = !input.ctrl && !input.meta && !input.alt;

  if (ctx.inTextInput) {
    const isFunctionKey = /^F\d{1,2}$/.test(input.key);
    if (bare && input.key !== "Escape" && !isFunctionKey) { return none; }
  }

  if (ctx.vimKeys && !ctx.inTextInput && bare) {
    if (input.key === "g") {
      return ctx.pendingPrefix === "g"
        ? { action: "firstPage", pendingPrefix: null }
        : { action: null, pendingPrefix: "g" };
    }
    const vim = VIM.find((b) => matches(b, input, ctx.isMac));
    if (vim) { return { action: vim.action, pendingPrefix: null }; }
  }

  const conv = CONVENTIONAL.find((b) => matches(b, input, ctx.isMac));
  if (!conv || (ctx.inTextInput && ACTIONS_BLOCKED_WHILE_TYPING.has(conv.action))) { return none; }
  return { action: conv.action, pendingPrefix: null };
}

export interface CheatsheetRow {
  group: Binding["group"];
  label: string;
  keys: string[];
}

function displayKey(b: Binding, isMac: boolean): string {
  const names: Record<string, string> = {
    " ": "Space", ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→",
    PageDown: "PgDn", PageUp: "PgUp", Escape: "Esc",
  };
  const parts: string[] = [];
  if (b.mod) { parts.push(isMac ? "Cmd" : "Ctrl"); }
  if (b.alt) { parts.push(isMac ? "Option" : "Alt"); }
  if (b.shift) { parts.push("Shift"); }
  const base = names[b.key] ?? b.key;
  parts.push(b.mod && base.length === 1 ? base.toUpperCase() : base);
  return parts.join("+");
}

/**
 * Rows for the `?` overlay: one per action with every key that triggers it, vim keys included only when the layer is on.
 * @returns rows in table order, grouped by `group`.
 */
export function cheatsheetRows(ctx: Pick<KeyContext, "vimKeys" | "isMac">): CheatsheetRow[] {
  const rows = new Map<ReaderAction, CheatsheetRow>();
  const add = (b: Binding): void => {
    if (b.macOnly && !ctx.isMac) { return; }
    const row = rows.get(b.action) ?? { group: b.group, label: b.label, keys: [] };
    const k = displayKey(b, ctx.isMac);
    if (!row.keys.includes(k)) { row.keys.push(k); }
    rows.set(b.action, row);
  };
  CONVENTIONAL.forEach(add);
  if (ctx.vimKeys) {
    VIM.forEach(add);
    const first = rows.get("firstPage");
    if (first) { first.keys.push("gg"); }
  }
  const order: Binding["group"][] = ["Navigate", "Search", "Zoom", "View"];
  return [...rows.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}
