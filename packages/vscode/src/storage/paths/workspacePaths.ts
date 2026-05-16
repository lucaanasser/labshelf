/**
 * Re-exports LibraryPaths under the legacy WorkspacePaths name for backward compatibility.
 *
 * @depends storage/paths/libraryPaths
 * @dependents storage/paths/index.ts, storage/index.ts
 */
export { LibraryPaths as WorkspacePaths } from "./libraryPaths.js";
