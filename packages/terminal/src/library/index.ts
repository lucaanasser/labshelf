/** Public API of the terminal's library folder: the library on disk, its in-memory snapshot, search and paper operations. */
export { rankFuzzy } from "./fuzzy.js";
export { LibraryRoot, ensureLibraryStructure, looksLikeLibrary } from "./libraryRoot.js";
export { papersUnder, scanLibrary } from "./libraryScanner.js";
export type { CollectionNode, LibrarySnapshot, PaperEntry } from "./libraryScanner.js";
export { LibraryStore, paperComparator } from "./libraryStore.js";
export type { SortSpec } from "./libraryStore.js";
export { LibraryWatcher } from "./libraryWatcher.js";
export { TerminalPaperService } from "./paperService.js";
export type { ImportOutcome } from "./paperService.js";
export { matchPaper, parseQuery, searchDoc } from "./search.js";
export { SidecarReader } from "./sidecars.js";
