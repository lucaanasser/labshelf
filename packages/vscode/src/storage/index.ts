/**
 * Top-level barrel that re-exports every public symbol from the storage sub-package.
 *
 * @depends storage/fileSystemService, storage/paths/index, storage/data/index
 * @dependents none (consumers import directly or via extension.ts)
 */
export { FileSystemService } from "./fileSystemService.js";
export type { ILibraryPaths } from "./paths/index.js";
export { LibraryPaths, WorkspacePaths, resolveLibraryRoot, persistLibraryRoot, ensureLibraryStructure, runLibrarySetupWizard, reconfigureLibrary } from "./paths/index.js";
export type { PaperData } from "./data/index.js";
export { PaperDataStore, LibraryIndexer, migrateSidecarsFromDb } from "./data/index.js";
