/**
 * Listens for folder CustomEvents emitted by the tree view. The actual mutation
 * (new/rename/delete folder, with sentinel files and FolderService re-indexing)
 * lands in the next commit; this stub keeps the wiring contract stable so the
 * tree view does not break.
 *
 * @depends state/libraryStore
 * @dependents library-page/index
 */
import type { LibraryStore } from "../state/libraryStore";

/** Attaches no-op listeners so the tree view fires events safely. */
export function attachFolderController(_store: LibraryStore): void {
  document.addEventListener("labshelf:new-folder", () => {});
  document.addEventListener("labshelf:rename-folder", () => {});
  document.addEventListener("labshelf:delete-folder", () => {});
}
