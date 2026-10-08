/**
 * Reactive store for the library page. Holds the collection tree, every
 * paper record in the library, the open folder, the list controls (search,
 * status tab, sort, subfolder toggle), the selection, which papers have a PDF
 * on this device (pdfDirs) and which have a Find PDF search in flight (pdfBusy),
 * and the sync snapshot pulled from the background. Views subscribe to slices via
 * {@link select}, so they only re-render when their slice changes.
 *
 * The store is intentionally tiny — no framework — because every view file is
 * vanilla TS/DOM and the state surface is small. Selection is an immutable Set
 * replaced on every change so slice equality stays a reference check.
 *
 * @depends @labshelf/core PaperRecord, storage FolderNode, runtimeMessages
 * @dependents library-page/app, views, controllers
 */
import type { PaperRecord, PaperStatus } from "@labshelf/core";
import type { FolderNode } from "../../storage";
import type { SyncStatusData } from "../../platform/runtimeMessages";
import { PAPERS_DIR } from "@labshelf/core";

export type StatusFilter = "all" | PaperStatus;
export type SortKey = "title" | "creator" | "year" | "publication" | "status";
export type SortDir = 1 | -1;

export interface LibraryState {
  folders: FolderNode[];
  /** Every PaperRecord in the library; views derive the folder scope. */
  papers: PaperRecord[];
  /** "papers/foo/bar"-style path; "papers" is the library root. */
  folder: string;
  query: string;
  status: StatusFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  includeSub: boolean;
  selected: ReadonlySet<string>;
  anchor: string | null;
  cursor: string | null;
  sync: SyncStatusData | null;
  loading: boolean;
  /** Paper folder paths (record.path) whose folder holds a paper.pdf; the source of truth for hasPdf. */
  pdfDirs: ReadonlySet<string>;
  /** Paper ids with a "Find PDF" search in flight, so their row/detail show a spinner. */
  pdfBusy: ReadonlySet<string>;
}

type Listener<T> = (value: T) => void;
type Selector<T> = (state: LibraryState) => T;

export const INITIAL_STATE: LibraryState = {
  folders: [],
  papers: [],
  folder: PAPERS_DIR,
  query: "",
  status: "all",
  sortKey: "title",
  sortDir: 1,
  includeSub: true,
  selected: new Set(),
  anchor: null,
  cursor: null,
  sync: null,
  loading: false,
  pdfDirs: new Set(),
  pdfBusy: new Set(),
};

export class LibraryStore {
  private state: LibraryState;
  private readonly listeners = new Set<{ select: Selector<unknown>; cb: Listener<unknown>; prev: unknown }>();

  constructor(initial: Partial<LibraryState> = {}) {
    this.state = { ...INITIAL_STATE, ...initial };
  }

  /** Returns a shallow copy so callers cannot mutate internal state. */
  get(): LibraryState { return { ...this.state }; }

  /** Merges a partial update into state and notifies subscribers whose slice changed. */
  set(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch };
    for (const entry of this.listeners) {
      const next = entry.select(this.state);
      if (!shallowEqual(next, entry.prev)) {
        entry.prev = next;
        entry.cb(next);
      }
    }
  }

  /**
   * Subscribes to a slice of state. Returns an unsubscribe function. The
   * listener fires immediately with the current slice so views can render
   * without an explicit initial pull.
   */
  select<T>(selector: Selector<T>, listener: Listener<T>): () => void {
    const initial = selector(this.state);
    const entry = {
      select: selector as Selector<unknown>,
      cb: listener as Listener<unknown>,
      prev: initial as unknown,
    };
    this.listeners.add(entry);
    listener(initial);
    return () => { this.listeners.delete(entry); };
  }

  // ── selection helpers ──────────────────────────────────────────────────

  /** Selects exactly one paper and makes it the anchor and cursor. */
  selectOnly(id: string): void {
    this.set({ selected: new Set([id]), anchor: id, cursor: id });
  }

  /** Toggles one paper in the selection (Cmd/Ctrl-click). */
  toggleSelected(id: string): void {
    const next = new Set(this.state.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.set({ selected: next, anchor: id, cursor: id });
  }

  /** Selects the run of `order` between the anchor and `toId` (Shift-click / Shift-arrow). */
  selectRange(order: string[], toId: string): void {
    const a = this.state.anchor ? order.indexOf(this.state.anchor) : -1;
    const b = order.indexOf(toId);
    if (a === -1 || b === -1) { this.selectOnly(toId); return; }
    this.set({ selected: new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)), cursor: toId });
  }

  /** Clears the selection, anchor and cursor. */
  clearSelection(): void {
    if (this.state.selected.size === 0 && !this.state.cursor) return;
    this.set({ selected: new Set(), anchor: null, cursor: null });
  }

  /** Opens a folder: resets the per-folder list controls and selection like the VS Code panel. */
  openFolder(path: string): void {
    if (path === this.state.folder) return;
    this.set({ folder: path, query: "", status: "all", selected: new Set(), anchor: null, cursor: null });
  }
}

/**
 * Shallow equality for primitives, arrays, and plain objects. Good enough for
 * the slices we publish (records and primitives) and lets the store avoid
 * notifying listeners whose data did not actually change.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Object.is(v, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b) || a instanceof Set || b instanceof Set) return false;
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
