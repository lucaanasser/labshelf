/**
 * The TUI: a paper manager with yazi's feel. Three panes in yazi's column layout — folders, papers, preview — arranged
 * the way Zotero arranges its panes: folders are navigation, papers are the content (papers and folders never share a
 * list). h/l walk the hierarchy (paper → its folder → parent folder, and back down to opening the PDF), the papers pane
 * follows the hovered folder live, and everything else is a key away: multi-select, cut/paste moves, live
 * filter/find/search, fuzzy jumps, citation copying and Drive sync — over the same files the VS Code extension uses.
 * Changes made by VS Code or a sync appear live through the library watcher.
 *
 * The App holds UI state only; library changes go through TerminalPaperService and syncs through SyncService.
 * Rendering builds a fresh Screen per frame and the Terminal writes only the cells that changed.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type PaperRecord, type PaperStatus, formatAnnotationsMarkdown, paperFiles, type PaperData } from "@labshelf/core";

import type { SortKey } from "../app/config.js";
import type { AppContext } from "../app/context.js";
import { rankFuzzy, papersUnder, type PaperEntry, paperComparator, type SortSpec, type ImportOutcome, matchPaper, parseQuery, searchDoc } from "../library/index.js";
import { copyToClipboard, openExternal, revealInFileManager, runEditor, trashSupported } from "../platform/system.js";
import type { SyncOutcome, SyncStatus } from "../sync/syncService.js";
import { clearImages, drawImage, fitImage, pngSize, type CellRect } from "../tui/graphics.js";
import type { InputEvent, MouseEvent } from "../tui/input.js";
import { Screen, type Style } from "../tui/screen.js";
import type { TerminalSize } from "../tui/terminal.js";
import { stringWidth, truncate } from "../tui/text.js";
import { paperLink, relativeTime } from "./format.js";
import { keyLabel, resolveKeys, type Binding } from "./keymap.js";
import {
  drawField,
  drawOverlay,
  helpRows,
  type InlineInput,
  type Overlay,
  type PickerItem,
  type PickerOverlay,
  type PromptOverlay,
  type PromptPurpose,
} from "./overlays.js";
import { folderPreview, libraryOverview, paperLabel, paperPreview, PREVIEW_TABS, tabBar, type Line } from "./preview.js";
import {
  computeLayout,
  drawFolderRow,
  drawLines,
  drawPaperRow,
  drawSegments,
  drawSeparators,
  type FolderRowData,
  type Layout,
  type Rect,
} from "./render.js";
import { editText, textInput } from "./textInput.js";
import { theme } from "./theme.js";

/** What the App needs from the real terminal; tests and --dump-frame pass a fake. */
export interface TerminalLike {
  size(): TerminalSize;
  listen(onInput: (event: InputEvent) => void, onResize: (size: TerminalSize) => void): void;
  enter(): void;
  leave(): void;
  draw(frame: Screen, extra?: string): void;
  invalidate(): void;
  writeRaw(data: string): void;
  suspend<T>(run: () => T): T;
  stopJob(): void;
}

/** The folders pane key of the "All papers" row; every other key is a folder path relative to papers/ ("" = Unfiled). */
export const ALL = "*all";

export type Focus = "folders" | "papers";

export interface FolderRow extends FolderRowData {
  key: string;
}

interface Place {
  folder: string;
  search: string | undefined;
}

interface PaperCursor {
  id: string | undefined;
  index: number;
  offset: number;
}

interface Message {
  text: string;
  level: "info" | "warn" | "error";
  until: number;
}

interface ImagePlan {
  key: string;
  rect: CellRect;
  png: Uint8Array;
}

const SCROLL_MARGIN = 4;
const MESSAGE_MS = 5_000;
const SORT_LABEL: Record<SortKey, string> = { title: "title", year: "year", author: "author", status: "status", modified: "modified" };

function parentFolder(rel: string): string {
  if (rel === ALL || rel === "") { return ALL; }
  const i = rel.lastIndexOf("/");
  return i < 0 ? ALL : rel.slice(0, i);
}

function folderTitle(key: string): string {
  if (key === ALL) { return "All papers"; }
  if (key === "") { return "Unfiled"; }
  return key.split("/").join(" › ");
}

export class App {
  focus: Focus = "papers";
  folder = ALL;
  search: string | undefined;
  flatten = false;
  sort: SortSpec;
  filter = "";
  selection = new Set<string>();
  cut: string[] | undefined;
  overlay: Overlay | undefined;
  inline: InlineInput | undefined;
  previewTab = 0;
  previewScroll = 0;
  pending: string[] = [];
  message: Message | undefined;
  readonly tasks = new Map<string, string>();

  private back: Place[] = [];
  private forward: Place[] = [];
  private readonly cursors = new Map<string, PaperCursor>();
  private folderOffset = 0;
  private visualAnchor: number | undefined;
  private visualBase = new Set<string>();
  private findQuery = "";
  private searchOrigin: Place | undefined;
  private filterBeforeEdit = "";
  private readonly sidecars = new Map<string, PaperData>();
  private readonly sidecarLoading = new Set<string>();
  private papersCache: { key: string; papers: PaperEntry[] } | undefined;
  private foldersCache: { key: number; rows: FolderRow[] } | undefined;
  private image: { key: string; rect: CellRect } | undefined;
  private renderQueued = false;
  private size: TerminalSize;
  private resolveQuit: (() => void) | undefined;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly ctx: AppContext, private readonly term: TerminalLike, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.size = term.size();
    const prefs = ctx.config.terminal ?? {};
    this.sort = { key: prefs.sort ?? "title", reverse: prefs.sortReverse ?? false };
    ctx.store.onChange(() => {
      this.papersCache = undefined;
      this.foldersCache = undefined;
      this.sidecars.clear();
      this.dropStale();
      this.scheduleRender();
    });
    ctx.sync.onStatus(() => this.scheduleRender());
  }

  private get layout(): Layout {
    return computeLayout(this.size.cols, this.size.rows, this.focus);
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /**
   * Takes over the terminal and runs until the user quits.
   * @returns when the user quit
   */
  run(): Promise<void> {
    this.term.listen((event) => this.handle(event), (size) => this.resize(size));
    this.term.enter();
    this.render();
    const minutes = this.ctx.config.terminal?.autoSyncMinutes ?? 15;
    this.ctx.sync.startPeriodic(minutes);
    if (minutes > 0) {
      void this.ctx.sync.periodicTick(minutes * 60_000).then((outcome) => outcome && this.reportSync(outcome, true));
    }
    return new Promise((resolve) => { this.resolveQuit = resolve; });
  }

  private async quit(): Promise<void> {
    if (this.ctx.sync.status().state === "syncing") {
      this.notify("Finishing the sync before quitting…");
      this.render();
    }
    if (this.image) { this.term.writeRaw(clearImages(this.ctx.imageProtocol)); }
    await this.ctx.dispose();
    this.term.leave();
    this.resolveQuit?.();
  }

  private resize(size: TerminalSize): void {
    this.size = size;
    this.image = undefined;
    this.term.writeRaw(clearImages(this.ctx.imageProtocol));
    this.render();
  }

  /** Coalesces render requests from async work into one frame. */
  scheduleRender(): void {
    if (this.renderQueued) { return; }
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    const { screen, image } = this.frame();
    let extra = "";
    const protocol = this.ctx.imageProtocol;
    const sameImage = image && this.image && this.image.key === image.key
      && this.image.rect.x === image.rect.x && this.image.rect.y === image.rect.y
      && this.image.rect.cols === image.rect.cols && this.image.rect.rows === image.rect.rows;
    if (!sameImage) {
      if (this.image) {
        // kitty images sit on their own layer and are deleted; iTerm2 images are cell content, so repaint every cell.
        if (protocol === "kitty") { extra += clearImages(protocol); } else { this.term.invalidate(); }
      }
      if (image) { extra += drawImage(protocol, image.png, image.rect) + "\x1b[H"; }
      this.image = image ? { key: image.key, rect: image.rect } : undefined;
    }
    this.term.draw(screen, extra);
  }

  // ───────────────────────────── model ─────────────────────────────

  /**
   * Rows of the folders pane: All papers, Unfiled (when the library root holds papers), then the folder tree.
   * @returns the rows
   */
  folderRows(): FolderRow[] {
    const snapshot = this.ctx.store.snapshot;
    if (this.foldersCache?.key === snapshot.scannedAt) { return this.foldersCache.rows; }
    const root = snapshot.collections.get("");
    const rows: FolderRow[] = [{ key: ALL, label: "All papers", depth: 0, count: snapshot.papers.size, pseudo: true }];
    if (root?.paperIds.length) { rows.push({ key: "", label: "Unfiled", depth: 0, count: root.paperIds.length, pseudo: true }); }
    const walk = (rels: string[], depth: number): void => {
      for (const rel of rels) {
        const node = snapshot.collections.get(rel);
        if (!node) { continue; }
        rows.push({ key: rel, label: node.name, depth, count: node.total });
        walk(node.children, depth + 1);
      }
    };
    walk(root?.children ?? [], 0);
    this.foldersCache = { key: snapshot.scannedAt, rows };
    return rows;
  }

  private folderIndex(): number {
    const index = this.folderRows().findIndex((row) => row.key === this.folder);
    return index >= 0 ? index : 0;
  }

  private sourceKey(): string {
    return this.search !== undefined ? `search\0${this.search}` : `folder\0${this.folder}\0${this.folder === ALL || this.flatten}`;
  }

  /**
   * Papers of the current source (the hovered folder, or the search results), sorted and filtered.
   * @returns the papers
   */
  papers(): PaperEntry[] {
    const key = `${this.sourceKey()}\0${this.sort.key}${this.sort.reverse}\0${this.filter}\0${this.ctx.store.snapshot.scannedAt}`;
    if (this.papersCache?.key === key) { return this.papersCache.papers; }
    let papers: PaperEntry[];
    if (this.search !== undefined) {
      papers = this.ctx.store.search(this.search, this.sort);
      if (this.filter) {
        const q = parseQuery(this.filter);
        papers = papers.filter((p) => matchPaper(p.record, searchDoc(p.record), q) > 0);
      }
    } else {
      const rel = this.folder === ALL ? "" : this.folder;
      papers = this.ctx.store.listCollection(rel, { sort: this.sort, flatten: this.folder === ALL || this.flatten, filter: this.filter })
        .flatMap((e) => (e.kind === "paper" ? [e.paper] : []));
    }
    this.papersCache = { key, papers };
    return papers;
  }

  private cursorState(): PaperCursor {
    const key = this.sourceKey();
    let state = this.cursors.get(key);
    if (!state) {
      state = { id: undefined, index: 0, offset: 0 };
      this.cursors.set(key, state);
    }
    return state;
  }

  /**
   * Index of the hovered paper; follows the paper when the list changes underneath (sort, sync, VS Code).
   * @returns the index, -1 for an empty list
   */
  cursor(): number {
    const papers = this.papers();
    const state = this.cursorState();
    if (!papers.length) { return -1; }
    if (state.id) {
      const found = papers.findIndex((p) => p.record.id === state.id);
      if (found >= 0) {
        state.index = found;
        return found;
      }
    }
    state.index = Math.max(0, Math.min(state.index, papers.length - 1));
    state.id = papers[state.index]!.record.id;
    return state.index;
  }

  /** @returns the hovered paper of the papers pane */
  hoveredPaper(): PaperEntry | undefined {
    const index = this.cursor();
    return index >= 0 ? this.papers()[index] : undefined;
  }

  private setPaperCursor(index: number): void {
    const papers = this.papers();
    if (!papers.length) { return; }
    const state = this.cursorState();
    const clamped = Math.max(0, Math.min(index, papers.length - 1));
    if (state.id !== papers[clamped]!.record.id) { this.previewScroll = 0; }
    state.index = clamped;
    state.id = papers[clamped]!.record.id;
    if (this.visualAnchor !== undefined) { this.applyVisual(); }
  }

  private setFolder(key: string): void {
    if (key === this.folder && this.search === undefined) { return; }
    this.folder = key;
    this.search = undefined;
    this.filter = "";
    this.previewScroll = 0;
    this.exitVisual();
  }

  private move(delta: number): void {
    if (this.focus === "folders") {
      const rows = this.folderRows();
      const next = rows[Math.max(0, Math.min(this.folderIndex() + delta, rows.length - 1))];
      if (next) { this.setFolder(next.key); }
      return;
    }
    const index = this.cursor();
    if (index >= 0) { this.setPaperCursor(index + delta); }
  }

  private moveTo(position: "top" | "bottom"): void {
    if (this.focus === "folders") {
      const rows = this.folderRows();
      const row = position === "top" ? rows[0] : rows[rows.length - 1];
      if (row) { this.setFolder(row.key); }
      return;
    }
    this.setPaperCursor(position === "top" ? 0 : this.papers().length - 1);
  }

  // Papers the next action applies to: the selection, or the hovered paper while the papers pane has focus.
  private targetPapers(): PaperEntry[] {
    if (this.selection.size) {
      return [...this.selection].map((id) => this.ctx.store.paper(id)).filter((p): p is PaperEntry => Boolean(p));
    }
    if (this.focus !== "papers") { return []; }
    const hovered = this.hoveredPaper();
    return hovered ? [hovered] : [];
  }

  private hoveredFolderRel(): string | undefined {
    return this.focus === "folders" && this.folder !== ALL ? this.folder : undefined;
  }

  private dropStale(): void {
    for (const id of [...this.selection]) { if (!this.ctx.store.paper(id)) { this.selection.delete(id); } }
    if (this.cut) {
      this.cut = this.cut.filter((key) => (key.startsWith("p:") ? this.ctx.store.paper(key.slice(2)) : this.ctx.store.collection(key.slice(2))));
      if (!this.cut.length) { this.cut = undefined; }
    }
    if (this.folder !== ALL && !this.ctx.store.collection(this.folder)) {
      // Renamed or removed elsewhere: fall back to the nearest folder that still exists.
      let rel: string = this.folder;
      while (rel !== ALL && !this.ctx.store.collection(rel)) { rel = parentFolder(rel); }
      this.folder = rel;
    }
    if (this.folder === "" && !this.ctx.store.collection("")?.paperIds.length) { this.folder = ALL; }
  }

  private sidecar(id: string): PaperData | undefined {
    const cached = this.sidecars.get(id);
    if (cached) { return cached; }
    if (!this.sidecarLoading.has(id)) {
      this.sidecarLoading.add(id);
      void this.ctx.sidecars.load(id).then((data) => {
        this.sidecars.set(id, data);
        this.sidecarLoading.delete(id);
        this.scheduleRender();
      }, () => this.sidecarLoading.delete(id));
    }
    return undefined;
  }

  // ───────────────────────────── navigation ─────────────────────────────

  private remember(): void {
    this.back.push({ folder: this.folder, search: this.search });
    if (this.back.length > 100) { this.back.shift(); }
    this.forward = [];
  }

  private jumpToFolder(key: string): void {
    this.remember();
    this.setFolder(key);
    this.focus = "papers";
  }

  private revealPaper(id: string): void {
    const paper = this.ctx.store.paper(id);
    if (!paper) { return; }
    this.remember();
    this.setFolder(paper.collection);
    this.flatten = false;
    this.focus = "papers";
    this.cursorState().id = id;
  }

  private up(): void {
    if (this.focus === "papers") {
      if (this.search !== undefined) { return this.leaveSearch(); }
      this.focus = "folders";
      return;
    }
    this.setFolder(parentFolder(this.folder));
  }

  private down(): void {
    if (this.focus === "folders") {
      this.focus = "papers";
      return;
    }
    const paper = this.hoveredPaper();
    if (paper) { this.openPdf(paper); }
  }

  private leaveSearch(): void {
    const origin = this.searchOrigin;
    this.searchOrigin = undefined;
    this.search = undefined;
    this.filter = "";
    if (origin) { this.folder = origin.folder; }
  }

  private historyStep(direction: "back" | "forward"): void {
    const from = direction === "back" ? this.back : this.forward;
    const to = direction === "back" ? this.forward : this.back;
    const target = from.pop();
    if (!target) { return; }
    to.push({ folder: this.folder, search: this.search });
    this.folder = target.folder;
    this.search = target.search;
    this.filter = "";
    this.exitVisual();
  }

  // ───────────────────────────── input ─────────────────────────────

  /**
   * Handles one input event (keys, paste, mouse).
   * @returns void
   */
  handle(event: InputEvent): void {
    try {
      if (event.type === "mouse") {
        this.handleMouse(event);
      } else if (this.overlay) {
        this.handleOverlay(event);
      } else if (this.inline) {
        this.handleInline(event);
      } else if (event.type === "key") {
        this.handleKey(event.id);
      }
    } catch (error) {
      this.fail(error);
    }
    this.render();
  }

  private handleKey(id: string): void {
    this.pending.push(id);
    const resolution = resolveKeys(this.pending);
    if (resolution.kind === "prefix") { return; }
    const keys = this.pending;
    this.pending = [];
    if (resolution.kind === "none") {
      if (keys.length > 1 && id !== "esc") { this.handleKey(id); }
      return;
    }
    this.dispatch(resolution.binding);
  }

  private pageSize(): number {
    return Math.max(1, (this.layout.papers ?? this.layout.folders)!.h - 1);
  }

  private dispatch(binding: Binding): void {
    const page = this.pageSize();
    switch (binding.action) {
      case "down": return this.move(1);
      case "up": return this.move(-1);
      case "top": return this.moveTo("top");
      case "bottom": return this.moveTo("bottom");
      case "halfDown": return this.move(Math.floor(page / 2));
      case "halfUp": return this.move(-Math.floor(page / 2));
      case "pageDown": return this.move(page);
      case "pageUp": return this.move(-page);
      case "parent": return this.up();
      case "enter": return this.down();
      case "open": {
        const paper = this.targetPapers()[0];
        if (paper) { this.openPdf(paper); }
        return;
      }
      case "reveal": {
        const rel = this.hoveredFolderRel();
        const paper = this.focus === "papers" ? this.hoveredPaper() : undefined;
        if (paper) { revealInFileManager(paper.record.path); } else if (rel !== undefined) { revealInFileManager(this.ctx.paths.collectionDir(rel)); }
        return;
      }
      case "back": return this.historyStep("back");
      case "forward": return this.historyStep("forward");
      case "home": return this.jumpToFolder(ALL);
      case "toggleFlatten":
        this.flatten = !this.flatten;
        this.notify(this.flatten ? "Including papers from subfolders" : "Showing only the papers directly in each folder");
        return;
      case "previewDown": this.previewScroll += 3; return;
      case "previewUp": this.previewScroll = Math.max(0, this.previewScroll - 3); return;
      case "nextTab": this.previewTab = (this.previewTab + 1) % PREVIEW_TABS.length; this.previewScroll = 0; return;
      case "prevTab": this.previewTab = (this.previewTab + PREVIEW_TABS.length - 1) % PREVIEW_TABS.length; this.previewScroll = 0; return;
      case "filter":
        this.focus = "papers";
        this.filterBeforeEdit = this.filter;
        this.inline = { purpose: "filter", input: textInput(this.filter) };
        return;
      case "find":
        this.focus = "papers";
        this.inline = { purpose: "find", input: textInput("") };
        return;
      case "findNext": return this.findStep(1);
      case "findPrev": return this.findStep(-1);
      case "search":
        if (this.search === undefined) { this.searchOrigin = { folder: this.folder, search: undefined }; }
        this.focus = "papers";
        this.inline = { purpose: "search", input: textInput(this.search ?? "") };
        return;
      case "jumpCollection": return this.openFolderPicker("Jump to folder", (rel) => this.jumpToFolder(rel));
      case "jumpPaper": return this.openPaperPicker();
      case "toggleSelect": return this.toggleSelect();
      case "visual": return this.toggleVisual();
      case "selectAll":
        if (this.focus === "papers") { for (const paper of this.papers()) { this.selection.add(paper.record.id); } }
        return;
      case "escape": return this.escape();
      case "status": return this.setStatus(binding.arg as PaperStatus);
      case "tags": return this.promptTags();
      case "note": return this.editNote();
      case "cut": return this.cutTargets();
      case "paste": return this.paste();
      case "moveTo": return this.moveToPicker();
      case "trash": return this.confirmTrash();
      case "add": return this.promptAdd();
      case "rename": return this.promptRename();
      case "exportBib": return this.openPrompt("export", "Export BibTeX", `./${this.exportName()}.bib`,
        `${this.targetsForExport().length} entries; the path is relative to ${process.cwd()}`);
      case "yank": return void this.yank(binding.arg ?? "keys");
      case "sort": return this.setSort(binding.arg ?? "title");
      case "sync": return void this.syncNow();
      case "reload":
        void this.ctx.store.reload().then(() => this.notify("Library reloaded"));
        return;
      case "command": return this.openPrompt("command", "Command", "",
        "sync · login · logout · reload · export <file> · mkdir <name> · add <input> · sort <key> [desc] · cd <folder> · where · q");
      case "help": this.overlay = { kind: "help", scroll: 0 }; return;
      case "quit": return void this.quit();
      case "suspend":
        if (this.ctx.sync.status().state === "syncing") { return this.notify("Wait for the sync to finish before suspending", "warn"); }
        return this.term.stopJob();
    }
  }

  private escape(): void {
    if (this.visualAnchor !== undefined) { return this.exitVisual(); }
    if (this.selection.size) { return this.selection.clear(); }
    if (this.filter) {
      this.filter = "";
      return;
    }
    if (this.cut) {
      this.cut = undefined;
      this.notify("Cut cleared");
      return;
    }
    if (this.search !== undefined) { this.leaveSearch(); }
  }

  // ───────────────────────────── selection ─────────────────────────────

  private toggleSelect(): void {
    if (this.focus !== "papers") { return; }
    const paper = this.hoveredPaper();
    if (!paper) { return; }
    const id = paper.record.id;
    if (this.selection.has(id)) { this.selection.delete(id); } else { this.selection.add(id); }
    this.move(1);
  }

  private toggleVisual(): void {
    if (this.visualAnchor !== undefined) { return this.exitVisual(); }
    if (this.focus !== "papers") { return; }
    const index = this.cursor();
    if (index < 0) { return; }
    this.visualAnchor = index;
    this.visualBase = new Set(this.selection);
    this.applyVisual();
  }

  private applyVisual(): void {
    if (this.visualAnchor === undefined) { return; }
    const papers = this.papers();
    const index = this.cursorState().index;
    const [from, to] = this.visualAnchor <= index ? [this.visualAnchor, index] : [index, this.visualAnchor];
    this.selection = new Set(this.visualBase);
    for (let i = from; i <= to; i++) {
      const paper = papers[i];
      if (paper) { this.selection.add(paper.record.id); }
    }
  }

  private exitVisual(): void {
    this.visualAnchor = undefined;
    this.visualBase = new Set();
  }

  // ───────────────────────────── find / filter / search ─────────────────────────────

  private findStep(direction: 1 | -1, from = this.cursor()): void {
    if (!this.findQuery) { return; }
    const q = parseQuery(this.findQuery);
    const matches: number[] = [];
    this.papers().forEach((p, i) => { if (matchPaper(p.record, searchDoc(p.record), q) > 0) { matches.push(i); } });
    if (!matches.length) {
      this.notify(`No match for "${this.findQuery}"`, "warn");
      return;
    }
    const next = direction === 1
      ? matches.find((i) => i > from) ?? matches[0]!
      : [...matches].reverse().find((i) => i < from) ?? matches[matches.length - 1]!;
    this.setPaperCursor(next);
  }

  private handleInline(event: InputEvent): void {
    const inline = this.inline!;
    if (event.type === "key" && (event.id === "esc" || event.id === "C-c")) {
      if (inline.purpose === "filter") { this.filter = this.filterBeforeEdit; }
      if (inline.purpose === "search") { this.leaveSearch(); }
      this.inline = undefined;
      return;
    }
    if (event.type === "key" && event.id === "enter") {
      this.inline = undefined;
      if (inline.purpose === "search") {
        if (!inline.input.value.trim()) {
          this.leaveSearch();
        } else if (this.searchOrigin) {
          this.back.push(this.searchOrigin);
          this.forward = [];
        }
      }
      return;
    }
    if (event.type === "key" && (event.id === "down" || event.id === "C-n")) { return this.move(1); }
    if (event.type === "key" && (event.id === "up" || event.id === "C-p")) { return this.move(-1); }
    const next = editText(inline.input, event);
    if (!next) { return; }
    inline.input = next;
    if (inline.purpose === "filter") {
      this.filter = next.value;
    } else if (inline.purpose === "find") {
      this.findQuery = next.value;
      this.findStep(1, this.cursor() - 1);
    } else {
      this.search = next.value;
      const state = this.cursorState();
      state.id = undefined;
      state.index = 0;
    }
  }

  // ───────────────────────────── overlays ─────────────────────────────

  private openPrompt(purpose: PromptPurpose, title: string, value: string, hint?: string, targets: string[] = []): void {
    this.overlay = { kind: "prompt", purpose, title, input: textInput(value), completions: [], targets, ...(hint ? { hint } : {}) };
  }

  private handleOverlay(event: InputEvent): void {
    const overlay = this.overlay!;
    const key = event.type === "key" ? event.id : undefined;
    if (overlay.kind === "help") {
      const max = helpRows().length;
      if (key === "j" || key === "down") { overlay.scroll = Math.min(overlay.scroll + 1, max); }
      else if (key === "k" || key === "up") { overlay.scroll = Math.max(0, overlay.scroll - 1); }
      else if (key === "C-d" || key === "pagedown" || key === "space") { overlay.scroll = Math.min(overlay.scroll + 10, max); }
      else if (key === "C-u" || key === "pageup") { overlay.scroll = Math.max(0, overlay.scroll - 10); }
      else if (key === "esc" || key === "q" || key === "?" || key === "C-c" || key === "enter") { this.overlay = undefined; }
      return;
    }
    if (overlay.kind === "confirm") {
      if (key === "y" || key === "Y" || key === "enter") {
        this.overlay = undefined;
        overlay.onYes();
      } else if (key === "n" || key === "N" || key === "esc" || key === "C-c" || key === "q") {
        this.overlay = undefined;
      }
      return;
    }
    if (key === "esc" || key === "C-c") {
      this.overlay = undefined;
      return;
    }
    if (overlay.kind === "picker") { return this.handlePicker(overlay, event); }
    if (key === "enter") {
      this.overlay = undefined;
      this.submitPrompt(overlay);
      return;
    }
    if (key === "tab") {
      void this.complete(overlay);
      return;
    }
    const next = editText(overlay.input, event);
    if (next) {
      overlay.input = next;
      overlay.completions = [];
    }
  }

  private handlePicker(picker: PickerOverlay, event: InputEvent): void {
    const key = event.type === "key" ? event.id : undefined;
    if (key === "enter") {
      const item = picker.filtered[picker.index];
      this.overlay = undefined;
      if (item) { picker.onPick(item); }
      return;
    }
    if (key === "down" || key === "C-n" || key === "C-j" || key === "tab") {
      picker.index = Math.min(picker.index + 1, picker.filtered.length - 1);
      return;
    }
    if (key === "up" || key === "C-p" || key === "C-k" || key === "S-tab") {
      picker.index = Math.max(picker.index - 1, 0);
      return;
    }
    const next = editText(picker.input, event);
    if (next) {
      picker.input = next;
      picker.filtered = rankFuzzy(picker.items, next.value, (item) => `${item.label} ${item.detail ?? ""}`);
      picker.index = 0;
    }
  }

  private openFolderPicker(title: string, onPick: (rel: string) => void, options: { exclude?: (rel: string) => boolean; withAll?: boolean } = {}): void {
    const nodes = [...this.ctx.store.snapshot.collections.values()].filter((node) => !options.exclude?.(node.rel));
    const items: PickerItem[] = nodes
      .map((node) => ({ id: node.rel, label: node.rel ? node.rel.split("/").join(" › ") : "Library root (unfiled)", detail: String(node.total) }))
      .sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.label.localeCompare(b.label)));
    if (options.withAll !== false) {
      items.unshift({ id: ALL, label: "All papers", detail: String(this.ctx.store.snapshot.papers.size) });
    }
    this.overlay = { kind: "picker", title, input: textInput(), items, filtered: items, index: 0, onPick: (item) => onPick(item.id) };
  }

  private openPaperPicker(): void {
    const items: PickerItem[] = [...this.ctx.store.snapshot.papers.values()].map((entry) => ({
      id: entry.record.id,
      label: paperLabel(entry.record),
      detail: entry.collection || "unfiled",
    }));
    this.overlay = { kind: "picker", title: "Jump to paper", input: textInput(), items, filtered: items, index: 0, onPick: (item) => this.revealPaper(item.id) };
  }

  // Tab completion: paths in the add prompt, tags in the tag prompts.
  private async complete(prompt: PromptOverlay): Promise<void> {
    if (prompt.purpose === "add") {
      const { completed, candidates } = await completePath(prompt.input.value);
      prompt.input = textInput(completed);
      prompt.completions = candidates;
    } else if (prompt.purpose === "tags" || prompt.purpose === "tagsBatch") {
      const value = prompt.input.value;
      const sep = prompt.purpose === "tags" ? value.lastIndexOf(",") : value.lastIndexOf(" ");
      const head = value.slice(0, sep + 1);
      const rawWord = value.slice(sep + 1).trimStart();
      const sign = prompt.purpose === "tagsBatch" && /^[+-]/.test(rawWord) ? rawWord[0]! : "";
      const word = rawWord.slice(sign.length).toLowerCase();
      const tags = this.ctx.store.tagCounts().map((t) => t.tag).filter((t) => t.toLowerCase().startsWith(word));
      if (tags.length === 1) {
        const glue = prompt.purpose === "tags" && head ? " " : "";
        prompt.input = textInput(`${head}${glue}${sign}${tags[0]}${prompt.purpose === "tags" ? ", " : " "}`);
        prompt.completions = [];
      } else {
        prompt.completions = tags.slice(0, 8);
      }
    }
    this.render();
  }

  // Where new papers and pasted items go: the hovered folder; All papers and search results mean the library root.
  private targetFolder(): string {
    if (this.search !== undefined || this.folder === ALL) { return ""; }
    return this.folder;
  }

  private submitPrompt(prompt: PromptOverlay): void {
    const value = prompt.input.value.trim();
    switch (prompt.purpose) {
      case "add": {
        if (!value) { return; }
        const parent = prompt.targets[0] ?? this.targetFolder();
        // yazi's convention: a single name ending in "/" creates a folder; anything else is a path, URL or identifier.
        const folderOnly = prompt.targets[1] === "folder";
        if (folderOnly || (/^[^/]+\/$/.test(value) && !looksLikePath(value))) {
          const name = value.replace(/\/+$/, "");
          void this.task("folder", "creating folder", async () => {
            this.folder = await this.ctx.papers.createCollection(parent, name);
            this.focus = "folders";
            this.notify(`Folder "${name}" created`);
          });
          return;
        }
        void this.importInputs([value], parent);
        return;
      }
      case "tags": {
        const id = prompt.targets[0];
        if (!id) { return; }
        const tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        void this.task("tags", "saving tags", async () => {
          await this.ctx.papers.updateFields(id, { tags });
          this.notify(tags.length ? `Tags: ${tags.join(", ")}` : "Tags cleared");
        });
        return;
      }
      case "tagsBatch": {
        const add: string[] = [];
        const remove: string[] = [];
        for (const token of value.split(/\s+/).filter((t) => t && t !== "+" && t !== "-")) {
          if (token.startsWith("-")) { remove.push(token.slice(1)); } else { add.push(token.replace(/^\+/, "")); }
        }
        if (!add.length && !remove.length) { return; }
        void this.task("tags", "saving tags", async () => {
          const outcome = await this.ctx.papers.editTags(prompt.targets, add, remove);
          this.notifyBatch(outcome.done.length, outcome.failed, "updated");
          this.selection.clear();
        });
        return;
      }
      case "rename": {
        const rel = prompt.targets[0];
        if (rel === undefined || !value) { return; }
        void this.task("rename", "renaming", async () => {
          this.folder = await this.ctx.papers.renameCollection(rel, value);
          this.notify(`Renamed to "${value}"`);
        });
        return;
      }
      case "export": {
        if (!value) { return; }
        const records = this.targetsForExport();
        void this.task("export", "exporting", async () => {
          const file = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()));
          await fs.writeFile(file, this.ctx.papers.bibtexFor(records));
          this.notify(`${records.length} BibTeX entries written to ${file}`);
        });
        return;
      }
      case "command":
        return this.runCommand(value);
    }
  }

  // ───────────────────────────── actions ─────────────────────────────

  private openPdf(paper: PaperEntry): void {
    if (paper.record.hasPdf === false) {
      const link = paperLink(paper.record);
      this.notify(`No PDF on this device for ${paper.record.id}${link ? " — y d copies its link" : ""}`, "warn");
      return;
    }
    const viewer = process.env["LABSHELF_PDF_VIEWER"] || this.ctx.config.terminal?.pdfViewer;
    openExternal(paperFiles(paper.record.path, path.join).pdf, viewer);
    this.notify(`Opened ${truncate(paper.record.title, 60)}`);
  }

  private needPapers(): PaperEntry[] {
    const papers = this.targetPapers();
    if (!papers.length && this.focus === "folders") { this.notify("Move to the papers (l) or select some first", "warn"); }
    return papers;
  }

  private setStatus(status: PaperStatus): void {
    const papers = this.needPapers();
    if (!papers.length) { return; }
    void this.task("status", "saving", async () => {
      const outcome = await this.ctx.papers.setStatus(papers.map((p) => p.record.id), status);
      this.notifyBatch(outcome.done.length, outcome.failed, `marked ${status}`);
      this.selection.clear();
    });
  }

  private promptTags(): void {
    const papers = this.needPapers();
    if (!papers.length) { return; }
    if (papers.length === 1) {
      const record = papers[0]!.record;
      this.openPrompt("tags", `Tags of ${truncate(record.title, 50)}`, (record.tags ?? []).join(", ") + (record.tags?.length ? ", " : ""),
        "Comma-separated; Tab completes existing tags", [record.id]);
    } else {
      this.openPrompt("tagsBatch", `Tags of ${papers.length} papers`, "+", "+tag adds, -tag removes; Tab completes", papers.map((p) => p.record.id));
    }
  }

  private editNote(): void {
    const paper = this.needPapers()[0];
    if (!paper) { return; }
    const record = paper.record;
    const file = path.join(os.tmpdir(), `labshelf-note-${record.id.replace(/[^\w.-]/g, "_")}.md`);
    const before = record.note ?? "";
    void (async () => {
      await fs.writeFile(file, before);
      const ok = this.term.suspend(() => runEditor(file));
      this.image = undefined;
      const after = (await fs.readFile(file, "utf8")).replace(/\s+$/, "");
      await fs.rm(file, { force: true });
      if (!ok) {
        this.notify("The editor exited with an error; note not saved", "warn");
      } else if (after !== before.replace(/\s+$/, "")) {
        await this.ctx.papers.updateFields(record.id, { note: after });
        this.notify(after ? "Note saved" : "Note cleared");
      }
      this.render();
    })().catch((error: unknown) => this.fail(error));
  }

  private cutTargets(): void {
    const folder = this.hoveredFolderRel();
    if (folder !== undefined && !this.selection.size) {
      if (folder === "") { return this.notify("The library root cannot be moved", "warn"); }
      this.cut = [`c:${folder}`];
      this.notify(`Folder "${folderTitle(folder)}" cut — hover the destination folder and press p`);
      return;
    }
    const papers = this.needPapers();
    if (!papers.length) { return; }
    this.cut = papers.map((p) => `p:${p.record.id}`);
    this.selection.clear();
    this.notify(`${papers.length} paper${papers.length === 1 ? "" : "s"} cut — go to a folder and press p`);
  }

  private paste(): void {
    if (!this.cut?.length) { return this.notify("Nothing to paste — cut papers or a folder with x first", "warn"); }
    if (this.search !== undefined || this.folder === ALL) {
      return this.notify("Choose a folder to paste into (in All papers, use M to pick one)", "warn");
    }
    const target = this.folder;
    const keys = this.cut;
    this.cut = undefined;
    void this.task("move", "moving", () => this.moveKeys(keys, target));
  }

  private async moveKeys(keys: string[], target: string): Promise<void> {
    const paperIds = keys.filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
    const folders = keys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2));
    let moved = 0;
    const failed: Array<{ id: string; error: string }> = [];
    if (paperIds.length) {
      const outcome = await this.ctx.papers.movePapers(paperIds, target);
      moved += outcome.done.length;
      failed.push(...outcome.failed);
    }
    for (const rel of folders) {
      try {
        this.folder = await this.ctx.papers.moveCollection(rel, target);
        moved++;
      } catch (error) {
        failed.push({ id: rel, error: describe(error) });
      }
    }
    this.notifyBatch(moved, failed, `moved to ${folderTitle(target)}`);
  }

  private moveToPicker(): void {
    const folder = this.hoveredFolderRel();
    if (folder !== undefined && !this.selection.size) {
      if (folder === "") { return; }
      this.openFolderPicker(`Move folder "${folderTitle(folder)}" to`, (rel) => {
        void this.task("move", "moving", () => this.moveKeys([`c:${folder}`], rel === ALL ? "" : rel));
      }, { exclude: (rel) => rel === folder || rel.startsWith(folder + "/"), withAll: false });
      return;
    }
    const papers = this.needPapers();
    if (!papers.length) { return; }
    const keys = papers.map((p) => `p:${p.record.id}`);
    this.openFolderPicker(`Move ${papers.length} paper${papers.length === 1 ? "" : "s"} to`, (rel) => {
      this.selection.clear();
      void this.task("move", "moving", () => this.moveKeys(keys, rel === ALL ? "" : rel));
    }, { withAll: false });
  }

  private confirmTrash(): void {
    if (!trashSupported()) { return this.notify("Moving to the trash is not supported on this system", "error"); }
    const folder = this.hoveredFolderRel();
    if (folder !== undefined && !this.selection.size) {
      if (folder === "") { return; }
      const node = this.ctx.store.collection(folder);
      this.overlay = {
        kind: "confirm",
        title: "Move to trash",
        lines: [
          `Move folder "${folderTitle(folder)}" and its ${node?.total ?? 0} paper${node?.total === 1 ? "" : "s"} to the trash?`,
          "The next sync removes them from Drive and from VS Code too.",
        ],
        onYes: () => void this.task("trash", "moving to trash", async () => {
          await this.ctx.papers.trashCollection(folder);
          this.folder = parentFolder(folder);
          this.notify(`Folder "${folderTitle(folder)}" moved to the trash`);
        }),
      };
      return;
    }
    const papers = this.needPapers();
    if (!papers.length) { return; }
    this.overlay = {
      kind: "confirm",
      title: "Move to trash",
      lines: [
        papers.length === 1 ? `Move "${truncate(papers[0]!.record.title, 60)}" to the trash?` : `Move ${papers.length} papers to the trash?`,
        "The next sync removes them from Drive and from VS Code too.",
      ],
      onYes: () => {
        this.selection.clear();
        void this.task("trash", "moving to trash", async () => {
          const outcome = await this.ctx.papers.trashPapers(papers.map((p) => p.record.id));
          this.notifyBatch(outcome.done.length, outcome.failed, "moved to the trash");
        });
      },
    };
  }

  private promptAdd(): void {
    if (this.focus === "folders") {
      const parent = this.folder === ALL ? "" : this.folder;
      this.openPrompt("add", `New folder in ${parent ? folderTitle(parent) : "the library root"}`, "", "Folder name", [parent, "folder"]);
      return;
    }
    const target = this.targetFolder();
    this.openPrompt("add", `Add a paper to ${target ? folderTitle(target) : "the library root"}`, "",
      "PDF or folder path (Tab completes), PDF URL, DOI or arXiv id — or name/ for a new folder", [target]);
  }

  private promptRename(): void {
    const folder = this.hoveredFolderRel();
    if (folder === undefined || folder === "") {
      return this.notify(this.focus === "papers"
        ? "Paper titles stay as resolved (Drive folders are named after them); r renames folders"
        : "Hover a folder to rename it", "warn");
    }
    this.openPrompt("rename", "Rename folder", this.ctx.store.collection(folder)?.name ?? "", undefined, [folder]);
  }

  private exportName(): string {
    if (this.search !== undefined) { return "search"; }
    if (this.folder === ALL) { return "library"; }
    return path.basename(this.folder || "unfiled");
  }

  // What B exports: the selection, else the papers pane as shown (with subfolders when a folder is hovered unfiltered).
  private targetsForExport(): PaperRecord[] {
    if (this.selection.size) { return this.targetPapers().map((p) => p.record); }
    if (this.filter || this.search !== undefined || this.folder === ALL || this.flatten || this.folder === "") {
      return this.papers().map((p) => p.record);
    }
    return papersUnder(this.ctx.store.snapshot, this.folder).sort(paperComparator(this.sort)).map((p) => p.record);
  }

  private async yank(kind: string): Promise<void> {
    const papers = this.needPapers();
    if (!papers.length) { return; }
    const records = papers.map((p) => p.record);
    let text: string;
    let what: string;
    switch (kind) {
      case "cite": text = `\\cite{${records.map((r) => r.citeKey).join(",")}}`; what = "\\cite"; break;
      case "bibtex": text = this.ctx.papers.bibtexFor(records); what = "BibTeX"; break;
      case "link": {
        const links = records.map(paperLink).filter((l): l is string => Boolean(l));
        if (!links.length) { return this.notify("No DOI or URL stored", "warn"); }
        text = links.join("\n");
        what = links.length === 1 ? links[0]! : "links";
        break;
      }
      case "title": text = records.map((r) => r.title).join("\n"); what = "title"; break;
      case "path": text = records.map((r) => paperFiles(r.path, path.join).pdf).join("\n"); what = "PDF path"; break;
      case "markdown": {
        const parts: string[] = [];
        for (const record of records) {
          parts.push(formatAnnotationsMarkdown(record, (await this.ctx.sidecars.load(record.id)).annotations));
        }
        text = parts.join("\n\n");
        what = "highlights";
        break;
      }
      default: text = records.map((r) => r.citeKey).join(", "); what = records.length === 1 ? records[0]!.citeKey : "cite keys";
    }
    const how = await copyToClipboard(text, (seq) => this.term.writeRaw(seq));
    this.notify(how === "failed" ? "Could not reach the clipboard" : `Copied ${what}${records.length > 1 ? ` (${records.length})` : ""}`,
      how === "failed" ? "error" : "info");
    this.render();
  }

  private setSort(arg: string): void {
    const reverse = arg.endsWith("!");
    const key = arg.replace(/!$/, "") as SortKey;
    this.sort = { key, reverse };
    this.notify(`Sorted by ${SORT_LABEL[key]}${reverse ? ", reversed" : ""}`);
  }

  private async importInputs(inputs: string[], target: string): Promise<void> {
    await this.task("import", "importing", async () => {
      const outcomes = await this.ctx.papers.importAny(inputs, target, (p) => {
        this.tasks.set("import", `importing ${p.index}/${p.total}`);
        this.scheduleRender();
      });
      this.reportImport(outcomes);
    });
  }

  private reportImport(outcomes: ImportOutcome[]): void {
    const added = outcomes.filter((o): o is Extract<ImportOutcome, { status: "added" }> => o.status === "added");
    const duplicates = outcomes.filter((o): o is Extract<ImportOutcome, { status: "duplicate" }> => o.status === "duplicate");
    const failed = outcomes.filter((o): o is Extract<ImportOutcome, { status: "failed" }> => o.status === "failed");
    if (!outcomes.length) { return this.notify("No PDF found there", "warn"); }
    if (added.length === 1 && !duplicates.length && !failed.length) {
      const paper = added[0]!.paper;
      this.revealPaper(paper.id);
      return this.notify(`Added "${truncate(paper.title, 60)}"${added[0]!.needsReview ? " — metadata unconfirmed, check it" : ""}`);
    }
    if (duplicates.length === 1 && !added.length && !failed.length) {
      this.revealPaper(duplicates[0]!.existingId);
      return this.notify(`Already in the library as ${duplicates[0]!.existingId}`, "warn");
    }
    const parts = [`${added.length} added`];
    if (duplicates.length) { parts.push(`${duplicates.length} already in the library`); }
    if (failed.length) { parts.push(`${failed.length} failed: ${failed[0]!.error}`); }
    this.notify(parts.join(", "), failed.length ? "warn" : "info");
  }

  private async syncNow(): Promise<void> {
    const status = this.ctx.sync.status();
    if (status.state === "unconfigured") {
      return this.notify("Drive sync needs the VS Code extension's OAuth client (see labshelf doctor)", "error");
    }
    if (status.state === "disconnected") { return this.notify("Not signed in to Google Drive — run :login", "warn"); }
    this.reportSync(await this.ctx.sync.syncNow("manual"), false);
  }

  private reportSync(outcome: SyncOutcome, quiet: boolean): void {
    switch (outcome.kind) {
      case "synced": {
        const r = outcome.record;
        const moved = r.uploaded + r.downloaded + r.deletedLocal + r.deletedRemote;
        if (r.conflicts.length) {
          this.notify(`Synced with ${r.conflicts.length} conflict(s): both versions kept, the remote one renamed "(conflict …)"`, "warn");
        } else if (moved || !quiet) {
          const removed = r.deletedLocal + r.deletedRemote;
          this.notify(moved ? `Synced: ${r.downloaded} down, ${r.uploaded} up${removed ? `, ${removed} removed` : ""}` : "Already in sync");
        }
        return;
      }
      case "busy":
        if (!quiet) { this.notify(`${appName(outcome.holder?.app)} is syncing this library right now; its changes will show up here`, "warn"); }
        return;
      case "skipped":
        if (!quiet) { this.notify(`Sync skipped: ${outcome.reason}`, "warn"); }
        return;
      case "failed":
        this.notify(outcome.reauth ? "Drive access expired — run :login" : `Sync failed: ${outcome.error}`, "error");
    }
  }

  private runCommand(line: string): void {
    const [name = "", ...args] = line.split(/\s+/).filter(Boolean);
    const rest = line.slice(name.length).trim();
    switch (name) {
      case "": return;
      case "q": case "quit": case "wq": return void this.quit();
      case "sync": case "s": return void this.syncNow();
      case "reload": case "r": void this.ctx.store.reload().then(() => this.notify("Library reloaded")); return;
      case "help": case "h": this.overlay = { kind: "help", scroll: 0 }; return;
      case "login": return void this.login();
      case "logout":
        void this.task("auth", "signing out", async () => {
          await this.ctx.sync.logout();
          this.notify("Signed out of Google Drive. The library stays on this computer.");
        });
        return;
      case "export":
        if (!rest) { return this.notify("Usage: :export <file.bib>", "warn"); }
        return this.submitPrompt({ kind: "prompt", purpose: "export", title: "", input: textInput(rest), completions: [], targets: [] });
      case "mkdir":
        if (!rest) { return this.notify("Usage: :mkdir <name>", "warn"); }
        return this.submitPrompt({ kind: "prompt", purpose: "add", title: "", input: textInput(rest), completions: [], targets: [this.targetFolder(), "folder"] });
      case "add":
        if (!rest) { return this.notify("Usage: :add <pdf | folder | url | doi | arxiv id>", "warn"); }
        return void this.importInputs([rest], this.targetFolder());
      case "sort": {
        const key = (args[0] ?? "title") as SortKey;
        if (!(key in SORT_LABEL)) { return this.notify(`Unknown sort key "${key}" (title, year, author, status, modified)`, "warn"); }
        return this.setSort(args[1] === "desc" || args[1] === "reverse" ? `${key}!` : key);
      }
      case "cd": {
        const rel = rest.replace(/^papers\/?/, "").replace(/^\/+|\/+$/g, "");
        if (!this.ctx.store.collection(rel)) { return this.notify(`No folder "${rest}"`, "warn"); }
        return this.jumpToFolder(rel === "" ? ALL : rel);
      }
      case "where":
        return this.notify(`Library: ${this.ctx.paths.root} · log: ${this.ctx.paths.layout.terminalLogPath()}`);
      default:
        this.notify(`Unknown command "${name}" — ? lists the keys`, "warn");
    }
  }

  private async login(): Promise<void> {
    await this.task("auth", "waiting for Google sign-in", async () => {
      await this.ctx.sync.login({
        openBrowser: (url) => openExternal(url),
        onUrl: (url) => {
          void copyToClipboard(url, (seq) => this.term.writeRaw(seq));
          this.notify("Sign in in the browser that just opened (the link is also on your clipboard)");
          this.render();
        },
      });
      this.notify("Connected to Google Drive — syncing…");
      this.render();
      this.reportSync(await this.ctx.sync.syncNow("login"), false);
    });
  }

  // Runs async work with a status-bar label and error reporting.
  private async task(id: string, label: string, work: () => Promise<void>): Promise<void> {
    this.tasks.set(id, label);
    this.scheduleRender();
    try {
      await work();
    } catch (error) {
      this.fail(error);
    } finally {
      this.tasks.delete(id);
      this.scheduleRender();
    }
  }

  private notifyBatch(done: number, failed: Array<{ id: string; error: string }>, verb: string): void {
    if (!failed.length) {
      this.notify(`${done} item${done === 1 ? "" : "s"} ${verb}`);
    } else {
      this.notify(`${done} ${verb}, ${failed.length} failed: ${failed[0]!.id} — ${failed[0]!.error}`, "error");
    }
  }

  /**
   * Shows a message in the status bar for a few seconds.
   * @returns void
   */
  notify(text: string, level: Message["level"] = "info"): void {
    this.message = { text, level, until: this.now() + MESSAGE_MS };
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.scheduleRender(), MESSAGE_MS + 50);
    this.messageTimer.unref?.();
    this.scheduleRender();
  }

  private fail(error: unknown): void {
    const message = describe(error);
    this.notify(message, "error");
    void this.ctx.logger.log("ERROR", "terminal/ui", message, {}, error instanceof Error ? error.stack : undefined);
  }

  // ───────────────────────────── mouse ─────────────────────────────

  private handleMouse(event: MouseEvent): void {
    if (this.overlay) { return; }
    const { folders, papers, preview } = this.layout;
    const inside = (rect: Rect | undefined): rect is Rect => Boolean(rect)
      && event.x >= rect!.x && event.x < rect!.x + rect!.w && event.y >= rect!.y && event.y < rect!.y + rect!.h;
    if (event.kind === "wheel-down" || event.kind === "wheel-up") {
      const delta = event.kind === "wheel-down" ? 3 : -3;
      if (inside(preview)) {
        this.previewScroll = Math.max(0, this.previewScroll + delta);
      } else {
        this.focus = inside(folders) ? "folders" : "papers";
        this.move(delta);
      }
      return;
    }
    if (event.kind !== "down" || event.button !== 0) { return; }
    if (inside(folders)) {
      const row = this.folderRows()[this.folderOffset + event.y - folders.y];
      this.focus = "folders";
      if (row) { this.setFolder(row.key); }
    } else if (inside(papers)) {
      const index = this.cursorState().offset + (event.y - papers.y);
      if (index < this.papers().length) {
        if (this.focus === "papers" && index === this.cursor()) { this.down(); } else { this.setPaperCursor(index); }
      }
      this.focus = "papers";
    }
  }

  // ───────────────────────────── drawing ─────────────────────────────

  /**
   * Builds the next frame.
   * @returns the screen and the thumbnail to draw over it, if any
   */
  frame(): { screen: Screen; image: ImagePlan | undefined } {
    const screen = new Screen(this.size.cols, this.size.rows);
    const layout = this.layout;
    this.drawHeader(screen, layout.header);
    if (layout.folders) { this.drawFolders(screen, layout.folders); }
    if (layout.papers) { this.drawPapers(screen, layout.papers); }
    let image: ImagePlan | undefined;
    if (layout.preview) { image = this.drawPreview(screen, layout.preview); }
    drawSeparators(screen, layout);
    this.drawStatus(screen, layout.status);
    if (this.overlay) {
      drawOverlay(screen, this.overlay);
      image = undefined;
    }
    return { screen, image };
  }

  private drawHeader(screen: Screen, rect: Rect): void {
    const segments: Array<{ text: string; style?: Style }> = [{ text: " LabShelf ", style: theme.brand }, { text: " " }];
    if (this.search !== undefined) {
      const count = this.papers().length;
      segments.push({ text: "search › ", style: theme.crumb });
      segments.push({ text: this.search || "(everything)", style: theme.crumbCurrent });
      segments.push({ text: `  ${count} result${count === 1 ? "" : "s"}`, style: theme.dim });
    } else if (this.folder === ALL || this.folder === "") {
      segments.push({ text: folderTitle(this.folder), style: theme.crumbCurrent });
    } else {
      const parts = this.folder.split("/");
      parts.forEach((part, i) => {
        if (i) { segments.push({ text: " › ", style: theme.dim }); }
        segments.push({ text: part, style: i === parts.length - 1 ? theme.crumbCurrent : theme.crumb });
      });
      if (this.flatten) { segments.push({ text: "  + subfolders", style: theme.dim }); }
    }
    const right = ` ${path.basename(this.ctx.paths.root)} `;
    drawSegments(screen, rect.x, rect.y, rect.x + rect.w - stringWidth(right), segments);
    screen.text(rect.x + rect.w - stringWidth(right), rect.y, right, theme.dim);
  }

  private drawFolders(screen: Screen, rect: Rect): void {
    const rows = this.folderRows();
    const index = this.folderIndex();
    const margin = Math.min(SCROLL_MARGIN, Math.floor((rect.h - 1) / 2));
    if (index < this.folderOffset + margin) { this.folderOffset = index - margin; }
    if (index > this.folderOffset + rect.h - 1 - margin) { this.folderOffset = index - rect.h + 1 + margin; }
    this.folderOffset = Math.max(0, Math.min(this.folderOffset, rows.length - rect.h));
    const cut = new Set(this.cut ?? []);
    for (let row = 0; row < rect.h; row++) {
      const i = this.folderOffset + row;
      const folder = rows[i];
      if (!folder) { break; }
      drawFolderRow(screen, rect.x, rect.y + row, rect.w, folder, {
        hovered: i === index && this.search === undefined,
        dimHover: this.focus !== "folders",
        selected: false,
        cut: cut.has(`c:${folder.key}`),
      });
    }
  }

  private drawPapers(screen: Screen, rect: Rect): void {
    const papers = this.papers();
    const state = this.cursorState();
    const index = this.cursor();
    if (!papers.length) {
      const hint: Line[] = this.filter
        ? [[{ text: "No paper matches the filter.", style: theme.dim }], [{ text: "Esc clears it.", style: theme.dim }]]
        : this.search !== undefined
          ? [[{ text: "Nothing found.", style: theme.dim }]]
          : [[{ text: "No papers here.", style: theme.dim }], [], [{ text: "a", style: theme.key }, { text: " adds a PDF, a DOI or an arXiv id", style: theme.dim }]];
      drawLines(screen, { ...rect, x: rect.x + 1, w: rect.w - 1 }, hint);
      return;
    }
    const margin = Math.min(SCROLL_MARGIN, Math.floor((rect.h - 1) / 2));
    if (index < state.offset + margin) { state.offset = index - margin; }
    if (index > state.offset + rect.h - 1 - margin) { state.offset = index - rect.h + 1 + margin; }
    state.offset = Math.max(0, Math.min(state.offset, papers.length - rect.h));
    const cut = new Set(this.cut ?? []);
    const showFolder = this.search !== undefined || this.folder === ALL || this.flatten;
    for (let row = 0; row < rect.h; row++) {
      const i = state.offset + row;
      const paper = papers[i];
      if (!paper) { break; }
      const detail = showFolder ? (paper.collection.split("/").pop() || "unfiled") : undefined;
      drawPaperRow(screen, rect.x, rect.y + row, rect.w, paper, {
        hovered: i === index,
        dimHover: this.focus !== "papers",
        selected: this.selection.has(paper.record.id),
        cut: cut.has(`p:${paper.record.id}`),
      }, detail);
    }
  }

  private drawPreview(screen: Screen, rect: Rect): ImagePlan | undefined {
    const inner = { x: rect.x + 1, y: rect.y, w: rect.w - 1, h: rect.h };
    if (this.focus === "folders" && this.search === undefined) {
      const snapshot = this.ctx.store.snapshot;
      if (this.folder === ALL) {
        drawLines(screen, inner, libraryOverview(snapshot), this.previewScroll);
        return undefined;
      }
      const node = snapshot.collections.get(this.folder);
      if (node) {
        const direct = node.paperIds.map((id) => snapshot.papers.get(id)).filter((p): p is PaperEntry => Boolean(p)).sort(paperComparator(this.sort));
        const lines = folderPreview(node, snapshot, direct, folderTitle(this.folder), { directOnly: this.folder === "" });
        drawLines(screen, inner, lines, this.previewScroll);
      }
      return undefined;
    }
    const paper = this.hoveredPaper();
    if (!paper) { return undefined; }
    const data = this.sidecar(paper.record.id);
    const tab = PREVIEW_TABS[this.previewTab]!;
    drawLines(screen, { ...inner, h: 1 }, [tabBar(tab, data?.annotations.length ?? 0)]);
    const body = { ...inner, y: inner.y + 2, h: inner.h - 2 };
    const bibtex = tab === "BibTeX" ? this.ctx.papers.bibtexFor([paper.record]) : "";
    const preview = paperPreview(paper, data, tab, body.w, bibtex);
    this.previewScroll = Math.min(this.previewScroll, Math.max(0, preview.lines.length - 1));
    const used = drawLines(screen, body, preview.lines, this.previewScroll);
    if (!preview.wantsImage || this.ctx.imageProtocol === "none" || this.overlay || this.previewScroll > 0) { return undefined; }
    const box: CellRect = { x: body.x, y: body.y + used + 1, cols: body.w, rows: body.h - used - 2 };
    if (box.rows < 8 || box.cols < 12 || paper.pdfBytes === undefined) { return undefined; }
    return this.thumbnailFor(paper, box);
  }

  private thumbnailFor(paper: PaperEntry, box: CellRect): ImagePlan | undefined {
    const request = { pdfPath: paperFiles(paper.record.path, path.join).pdf, sizeBytes: paper.pdfBytes ?? 0, mtimeMs: paper.modifiedMs };
    const png = this.ctx.thumbnails.peek(request);
    if (!png) {
      void this.ctx.thumbnails.get(request).then((result) => { if (result) { this.scheduleRender(); } });
      return undefined;
    }
    const size = pngSize(png);
    if (!size) { return undefined; }
    const aspect = Number(process.env["LABSHELF_CELL_ASPECT"]) || undefined;
    return { key: `${request.pdfPath}:${request.sizeBytes}`, rect: fitImage(size, box, aspect), png };
  }

  private drawStatus(screen: Screen, rect: Rect): void {
    const y = rect.y;
    screen.fill(rect.x, y, rect.w, 1);
    if (this.inline) {
      const label = this.inline.purpose === "filter" ? " FILTER " : this.inline.purpose === "find" ? " FIND " : " SEARCH ";
      const style = theme.mode[this.inline.purpose === "search" ? "SEARCH" : "FILTER"]!;
      const col = screen.text(0, y, label, style) + 1;
      const count = this.inline.purpose === "find" ? "" : ` ${this.papers().length} `;
      drawField(screen, col, y, rect.w - col - stringWidth(count), this.inline.input);
      screen.text(rect.w - stringWidth(count), y, count, theme.dim);
      return;
    }
    const mode = this.visualAnchor !== undefined ? "VISUAL" : this.filter ? "FILTER" : this.search !== undefined ? "SEARCH" : "NORMAL";
    const left: Array<{ text: string; style?: Style }> = [{ text: ` ${mode} `, style: theme.mode[mode]! }];
    if (this.focus === "folders") {
      left.push({ text: ` folder ${this.folderIndex() + 1}/${this.folderRows().length} `, style: theme.dim });
    } else {
      const count = this.papers().length;
      left.push({ text: ` ${count ? this.cursor() + 1 : 0}/${count} `, style: theme.dim });
    }
    if (this.selection.size) { left.push({ text: ` ${this.selection.size} selected `, style: theme.selectedMark }); }
    if (this.cut?.length) { left.push({ text: ` ${this.cut.length} cut `, style: theme.cutMark }); }
    if (this.filter) { left.push({ text: ` f: ${truncate(this.filter, 24)} `, style: theme.warn }); }
    if (this.pending.length) {
      const hints = resolveKeys(this.pending);
      left.push({ text: ` ${keyLabel(this.pending)} → `, style: theme.key });
      for (const option of (hints.kind === "prefix" ? hints.options : []).slice(0, 8)) {
        left.push({ text: option.keys[this.pending.length]!, style: theme.key });
        left.push({ text: ` ${option.desc.replace(/^(Mark|Copy|Sort by|Go to) /, "")}  `, style: theme.dim });
      }
    } else if (this.message && this.message.until > this.now()) {
      const style = this.message.level === "error" ? theme.error : this.message.level === "warn" ? theme.warn : theme.info;
      left.push({ text: " " + this.message.text, style });
    }
    const right = this.statusRight();
    const rightWidth = right.reduce((w, s) => w + stringWidth(s.text), 0);
    drawSegments(screen, rect.x, y, rect.x + rect.w - rightWidth - 1, left);
    drawSegments(screen, rect.x + rect.w - rightWidth, y, rect.x + rect.w, right);
  }

  private statusRight(): Array<{ text: string; style?: Style }> {
    const out: Array<{ text: string; style?: Style }> = [];
    for (const label of this.tasks.values()) { out.push({ text: ` ${label}… `, style: theme.warn }); }
    out.push({ text: ` ${SORT_LABEL[this.sort.key]}${this.sort.reverse ? "↓" : "↑"} `, style: theme.dim });
    out.push(syncSegment(this.ctx.sync.status(), this.now()));
    out.push({ text: " ? help ", style: theme.dim });
    return out;
  }
}

function appName(app: string | undefined): string {
  if (app === "vscode") { return "VS Code"; }
  if (app === "terminal") { return "Another terminal session"; }
  return "Another app";
}

/**
 * The sync part of the status bar.
 * @returns the segment
 */
export function syncSegment(status: SyncStatus, now: number): { text: string; style: Style } {
  switch (status.state) {
    case "unconfigured": return { text: " Drive: not set up ", style: theme.sync.off };
    case "disconnected": return { text: " Drive: signed out ", style: theme.sync.off };
    case "syncing": return { text: " syncing… ", style: theme.sync.busy };
    case "waiting": return { text: ` ${appName(status.holder?.app)} syncing `, style: theme.sync.busy };
    case "error": return { text: " sync failed ", style: theme.sync.error };
    default: {
      const last = status.lastRun;
      if (!last) { return { text: " Drive: not synced yet ", style: theme.sync.off }; }
      const by = last.app === "terminal" ? "" : ` (${last.app === "vscode" ? "VS Code" : last.app})`;
      return { text: ` synced ${relativeTime(last.finishedAt, now)}${by} `, style: theme.sync.ok };
    }
  }
}

function looksLikePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || value.startsWith(".");
}

/**
 * Completes a filesystem path for the add prompt (folders and PDFs only).
 * @returns the completed text and the other candidates
 */
export async function completePath(value: string): Promise<{ completed: string; candidates: string[] }> {
  const expanded = value.replace(/^~(?=$|\/)/, os.homedir());
  const dir = expanded.endsWith("/") ? expanded : path.dirname(expanded || ".");
  const prefix = expanded.endsWith("/") ? "" : path.basename(expanded);
  let names: Array<{ name: string; dir: boolean }>;
  try {
    names = (await fs.readdir(dir || ".", { withFileTypes: true }))
      .filter((d) => d.name.startsWith(prefix) && (!d.name.startsWith(".") || prefix.startsWith(".")))
      .filter((d) => d.isDirectory() || d.name.toLowerCase().endsWith(".pdf"))
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return { completed: value, candidates: [] };
  }
  if (!names.length) { return { completed: value, candidates: [] }; }
  const base = value.slice(0, value.length - prefix.length);
  if (names.length === 1) {
    const only = names[0]!;
    return { completed: base + only.name + (only.dir ? "/" : ""), candidates: [] };
  }
  let common = names[0]!.name;
  for (const { name } of names) {
    while (!name.startsWith(common)) { common = common.slice(0, -1); }
  }
  return { completed: base + common, candidates: names.map((n) => n.name + (n.dir ? "/" : "")) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
