/**
 * Reactive store for the library page. Holds the folder tree, the currently
 * selected folder + paper, the search query, and the sync status pulled from
 * the background. Views subscribe to specific slices via {@link select}, so
 * they only re-render when their slice changes.
 *
 * The store is intentionally tiny — no framework — because every view file is
 * vanilla TS/DOM and the state surface is small. If the library page grows a
 * richer interaction model later, replace this with a real state lib.
 *
 * @depends @labshelf/core PaperRecord, storage FolderNode, runtimeMessages
 * @dependents library-page/app, views, controllers
 */
import type { PaperRecord } from "@labshelf/core";
import type { FolderNode } from "../../storage";
import type { SyncStatusData } from "../../platform/runtimeMessages";

export interface LibraryState {
  folders: FolderNode[];
  /** "papers/foo/bar"-style path, or empty string for the library root. */
  selectedFolder: string;
  papers: PaperRecord[];
  selectedPaperId: string | null;
  search: string;
  sync: SyncStatusData | null;
  loading: boolean;
  error: string | null;
}

type Listener<T> = (value: T) => void;
type Selector<T> = (state: LibraryState) => T;

const INITIAL: LibraryState = {
  folders: [],
  selectedFolder: "papers",
  papers: [],
  selectedPaperId: null,
  search: "",
  sync: null,
  loading: false,
  error: null,
};

export class LibraryStore {
  private state: LibraryState = { ...INITIAL };
  private readonly listeners = new Set<{ select: Selector<unknown>; cb: Listener<unknown>; prev: unknown }>();

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
}

/**
 * Shallow equality for primitives, arrays, and plain objects. Good enough for
 * the slices we publish (records and primitives) and lets the store avoid
 * notifying listeners whose data did not actually change.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Object.is(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
