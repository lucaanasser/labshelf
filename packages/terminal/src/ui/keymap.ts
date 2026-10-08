/**
 * Key bindings of the TUI, as data: the dispatcher, the help screen and the prefix hints are all generated from this
 * table, so they cannot disagree. Keys follow yazi where the meaning carries over (hjkl, gg/G, H/L history, J/K preview
 * scroll, space/v selection, x/p cut-paste, f filter, / find, z jump, , sort, ? help) and add paper-specific ones
 * (m status, t tags, e note, y copy citation formats, S sync).
 *
 * @depends none
 * @dependents ui/app, ui/overlays (help)
 */

export type ActionId =
  | "down" | "up" | "top" | "bottom" | "halfDown" | "halfUp" | "pageDown" | "pageUp"
  | "parent" | "enter" | "open" | "reveal" | "back" | "forward" | "home" | "toggleFlatten"
  | "previewDown" | "previewUp" | "nextTab" | "prevTab"
  | "filter" | "find" | "findNext" | "findPrev" | "search" | "jumpCollection" | "jumpPaper"
  | "toggleSelect" | "visual" | "selectAll" | "escape"
  | "status" | "tags" | "note" | "cut" | "paste" | "moveTo" | "trash" | "add" | "rename" | "exportBib"
  | "yank" | "sort"
  | "sync" | "reload" | "command" | "help" | "quit" | "suspend";

export type BindingGroup = "Navigate" | "Find" | "Select" | "Papers" | "Copy" | "Sort" | "App";

export interface Binding {
  keys: string[];
  action: ActionId;
  arg?: string;
  desc: string;
  group: BindingGroup;
  /** Hidden from the help screen (duplicate keys such as arrows). */
  alias?: boolean;
}

const b = (keys: string | string[], action: ActionId, desc: string, group: BindingGroup, extra: Partial<Binding> = {}): Binding => ({
  keys: Array.isArray(keys) ? keys : [keys],
  action,
  desc,
  group,
  ...extra,
});

export const BINDINGS: Binding[] = [
  b("j", "down", "Move down", "Navigate"),
  b("down", "down", "Move down", "Navigate", { alias: true }),
  b("k", "up", "Move up", "Navigate"),
  b("up", "up", "Move up", "Navigate", { alias: true }),
  b("h", "parent", "Up: papers → folders → parent folder (leaves a search)", "Navigate"),
  b("left", "parent", "Up", "Navigate", { alias: true }),
  b("backspace", "parent", "Up", "Navigate", { alias: true }),
  b("l", "enter", "Down: folder → its papers → open the PDF", "Navigate"),
  b("right", "enter", "Down", "Navigate", { alias: true }),
  b("enter", "enter", "Down", "Navigate", { alias: true }),
  b(["g", "g"], "top", "Go to top", "Navigate"),
  b("home", "top", "Go to top", "Navigate", { alias: true }),
  b("G", "bottom", "Go to bottom", "Navigate"),
  b("end", "bottom", "Go to bottom", "Navigate", { alias: true }),
  b("C-d", "halfDown", "Half page down", "Navigate"),
  b("C-u", "halfUp", "Half page up", "Navigate"),
  b("C-f", "pageDown", "Page down", "Navigate", { alias: true }),
  b("pagedown", "pageDown", "Page down", "Navigate", { alias: true }),
  b("C-b", "pageUp", "Page up", "Navigate", { alias: true }),
  b("pageup", "pageUp", "Page up", "Navigate", { alias: true }),
  b("H", "back", "Back in history", "Navigate"),
  b("L", "forward", "Forward in history", "Navigate"),
  b(["g", "a"], "home", "Go to All papers", "Navigate"),
  b(".", "toggleFlatten", "Include papers from subfolders", "Navigate"),
  b("J", "previewDown", "Scroll preview down", "Navigate"),
  b("K", "previewUp", "Scroll preview up", "Navigate"),
  b("tab", "nextTab", "Next preview tab (Info, Abstract, Notes, BibTeX)", "Navigate"),
  b("S-tab", "prevTab", "Previous preview tab", "Navigate"),

  b("f", "filter", "Filter this list (query language)", "Find"),
  b("/", "find", "Find in this list", "Find"),
  b("n", "findNext", "Next match", "Find"),
  b("N", "findPrev", "Previous match", "Find"),
  b("s", "search", "Search the whole library (titles, authors, abstracts, notes, highlights)", "Find"),
  b("z", "jumpCollection", "Jump to a folder", "Find"),
  b("Z", "jumpPaper", "Jump to a paper", "Find"),

  b("space", "toggleSelect", "Select / unselect", "Select"),
  b("v", "visual", "Visual selection mode", "Select"),
  b("C-a", "selectAll", "Select all", "Select"),
  b("esc", "escape", "Clear selection, filter or search", "Select"),

  b("o", "open", "Open the PDF", "Papers"),
  b("O", "reveal", "Reveal the folder in the file manager", "Papers"),
  b(["m", "u"], "status", "Mark unread", "Papers", { arg: "unread" }),
  b(["m", "r"], "status", "Mark reading", "Papers", { arg: "reading" }),
  b(["m", "d"], "status", "Mark done", "Papers", { arg: "done" }),
  b("t", "tags", "Edit tags", "Papers"),
  b("e", "note", "Edit the note in $EDITOR", "Papers"),
  b("a", "add", "Add a paper: PDF, folder of PDFs, URL, DOI, arXiv id (in the folders pane: new folder)", "Papers"),
  b("x", "cut", "Cut (mark for moving)", "Papers"),
  b("p", "paste", "Paste: move cut items into this folder", "Papers"),
  b("M", "moveTo", "Move to a folder…", "Papers"),
  b("r", "rename", "Rename folder", "Papers"),
  b("d", "trash", "Move to the trash", "Papers"),
  b("B", "exportBib", "Export this list as a .bib file", "Papers"),

  b(["y", "k"], "yank", "Copy cite key(s)", "Copy", { arg: "keys" }),
  b(["y", "c"], "yank", "Copy \\cite{…}", "Copy", { arg: "cite" }),
  b(["y", "b"], "yank", "Copy BibTeX", "Copy", { arg: "bibtex" }),
  b(["y", "d"], "yank", "Copy DOI / URL", "Copy", { arg: "link" }),
  b(["y", "t"], "yank", "Copy title", "Copy", { arg: "title" }),
  b(["y", "p"], "yank", "Copy PDF path", "Copy", { arg: "path" }),
  b(["y", "m"], "yank", "Copy highlights as Markdown", "Copy", { arg: "markdown" }),

  b([",", "t"], "sort", "Sort by title", "Sort", { arg: "title" }),
  b([",", "y"], "sort", "Sort by year (newest first)", "Sort", { arg: "year" }),
  b([",", "a"], "sort", "Sort by first author", "Sort", { arg: "author" }),
  b([",", "s"], "sort", "Sort by status (reading first)", "Sort", { arg: "status" }),
  b([",", "m"], "sort", "Sort by last modified", "Sort", { arg: "modified" }),
  b([",", "T"], "sort", "Sort by title, reversed", "Sort", { arg: "title!", alias: true }),
  b([",", "Y"], "sort", "Sort by year, oldest first", "Sort", { arg: "year!", alias: true }),
  b([",", "A"], "sort", "Sort by first author, reversed", "Sort", { arg: "author!", alias: true }),
  b([",", "S"], "sort", "Sort by status, reversed", "Sort", { arg: "status!", alias: true }),
  b([",", "M"], "sort", "Sort by last modified, oldest first", "Sort", { arg: "modified!", alias: true }),

  b("S", "sync", "Sync with Google Drive now", "App"),
  b("R", "reload", "Reload the library from disk", "App"),
  b(":", "command", "Command line (:sync, :login, :logout, :export, :mkdir, :help…)", "App"),
  b("?", "help", "Help", "App"),
  b("f1", "help", "Help", "App", { alias: true }),
  b("q", "quit", "Quit", "App"),
  b("C-c", "quit", "Quit", "App", { alias: true }),
  b("C-z", "suspend", "Suspend to the shell", "App"),
];

export type KeyResolution =
  | { kind: "action"; binding: Binding }
  | { kind: "prefix"; options: Binding[] }
  | { kind: "none" };

/**
 * Matches the keys typed so far against the bindings.
 * @usedBy ui/app
 * @returns an action, a prefix waiting for more keys (with what can follow), or nothing
 */
export function resolveKeys(pending: string[], bindings: Binding[] = BINDINGS): KeyResolution {
  const candidates = bindings.filter((binding) => pending.every((key, i) => binding.keys[i] === key));
  const exact = candidates.find((binding) => binding.keys.length === pending.length);
  if (exact) { return { kind: "action", binding: exact }; }
  if (candidates.length) { return { kind: "prefix", options: candidates.filter((c) => !c.alias) }; }
  return { kind: "none" };
}

/**
 * "g g", "m r", "C-d" as shown on the help screen.
 * @usedBy ui/overlays, ui/render
 * @returns the label
 */
export function keyLabel(keys: string[]): string {
  return keys.map((k) => (k === "space" ? "Space" : k === "esc" ? "Esc" : k === "tab" ? "Tab" : k === "S-tab" ? "S-Tab" : k)).join(" ");
}
