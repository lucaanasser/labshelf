/**
 * Two-way binding between the open folder and the URL hash
 * (`#/papers/Project/Refs`), so the browser's back/forward buttons walk the
 * folder history and a reload lands on the same folder. The shell is never
 * rebuilt on navigation — only the store changes.
 *
 * @depends state/libraryStore, state/derive
 * @dependents library-page/index
 */
import { ROOT, isUnder } from "./state/derive";
import type { LibraryStore } from "./state/libraryStore";

/** Parses a location hash into a folder path, falling back to the root. */
export function folderFromHash(hash: string): string {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/+$/, "");
  return raw && isUnder(raw, ROOT) && !raw.split("/").some((s) => s === "" || s === "." || s === "..") ? raw : ROOT;
}

/** Builds the hash for a folder path. */
export function hashForFolder(folder: string): string {
  return `#/${folder.split("/").map(encodeURIComponent).join("/")}`;
}

/** Starts syncing store.folder <-> location.hash; returns a disposer. */
export function attachRouter(store: LibraryStore): () => void {
  store.openFolder(folderFromHash(location.hash));

  const onHash = (): void => { store.openFolder(folderFromHash(location.hash)); };
  window.addEventListener("hashchange", onHash);

  const unsub = store.select((s) => s.folder, (folder) => {
    const next = hashForFolder(folder);
    if (location.hash !== next) history.pushState(null, "", next);
    document.title = folder === ROOT ? "LabShelf" : `${folder.slice(folder.lastIndexOf("/") + 1)} — LabShelf`;
  });

  return () => { window.removeEventListener("hashchange", onHash); unsub(); };
}
