/**
 * Barrel that re-exports all data-layer types and classes from the storage/data sub-package.
 *
 * @depends storage/data/paperDataStore, storage/data/libraryIndexer, storage/data/migrateSidecars
 * @dependents storage/index.ts
 */
export type { PaperData } from "./paperDataStore.js";
export { PaperDataStore } from "./paperDataStore.js";
export { LibraryIndexer } from "./libraryIndexer.js";
export { migrateSidecarsFromDb } from "./migrateSidecars.js";
