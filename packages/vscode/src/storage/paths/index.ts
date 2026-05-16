/**
 * Barrel that re-exports all path-related types and functions from the paths sub-package.
 *
 * @depends storage/paths/libraryPaths, storage/paths/libraryLocation, storage/paths/workspacePaths
 * @dependents storage/index.ts
 */
export type { ILibraryPaths } from "./libraryPaths.js";
export { LibraryPaths } from "./libraryPaths.js";
export { resolveLibraryRoot, persistLibraryRoot, ensureLibraryStructure, runLibrarySetupWizard, reconfigureLibrary } from "./libraryLocation.js";
export { WorkspacePaths } from "./workspacePaths.js";
