/**
 * Listens for paper CustomEvents emitted by the detail view (open PDF, change
 * status, delete). The actual IDB mutations land in the next commit; this stub
 * keeps the view contract stable.
 *
 * @depends state/libraryStore
 * @dependents library-page/index
 */
import type { LibraryStore } from "../state/libraryStore";

/** Attaches no-op listeners so the detail view fires events safely. */
export function attachPaperController(_store: LibraryStore): void {
  document.addEventListener("labshelf:paper-action", () => {});
}
