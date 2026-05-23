/**
 * Barrel re-export for the library helpers (collection folder bookkeeping).
 *
 * @depends folderService
 * @dependents @labshelf/core index, @labshelf/vscode, @labshelf/browser
 */
export {
  FolderService,
  isUnderDir,
  rewritePath,
} from "./folderService.js";
export type {
  IPaperRecordIndex,
  FolderRelocation,
  FolderRemoval,
} from "./folderService.js";
