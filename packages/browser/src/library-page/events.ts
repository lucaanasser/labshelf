/**
 * Typed DOM CustomEvents that carry user intents from the views to the
 * controllers. Views stay IO-free: they emit an intent on `document`, and a
 * controller performs the IndexedDB / runtime work and updates the store.
 *
 * @depends @labshelf/core PaperStatus
 * @dependents library-page views (emit), controllers (listen)
 */
import type { PaperStatus } from "@labshelf/core";

export type PaperAction = "open-pdf" | "copy-cite" | "delete" | "move" | "find-pdf" | "attach-pdf";

export interface LibraryEvents {
  "labshelf:new-folder": { parent: string };
  "labshelf:rename-folder": { path: string };
  "labshelf:delete-folder": { path: string };
  "labshelf:paper-action": { ids: string[]; action: PaperAction };
  "labshelf:set-status": { ids: string[]; status: PaperStatus };
  "labshelf:move-papers": { ids: string[]; target: string };
  "labshelf:add-paper": Record<string, never>;
  "labshelf:sync-now": Record<string, never>;
}

/** Dispatches a typed intent on `document`. */
export function emit<K extends keyof LibraryEvents>(type: K, detail: LibraryEvents[K]): void {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

/** Listens for a typed intent; returns a disposer. */
export function on<K extends keyof LibraryEvents>(type: K, handler: (detail: LibraryEvents[K]) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<LibraryEvents[K]>).detail);
  document.addEventListener(type, listener);
  return () => document.removeEventListener(type, listener);
}
