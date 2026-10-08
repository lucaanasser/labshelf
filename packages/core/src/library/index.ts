/**
 * Barrel re-export for the library helpers (collection folder bookkeeping).
 *
 * @depends folderService, paperMetadata
 * @dependents @labshelf/core index, @labshelf/vscode, @labshelf/browser
 */
export {
  FolderService,
  isUnderDir,
} from "./folderService.js";
export type {
  IPaperRecordIndex,
  FolderRelocation,
  FolderRemoval,
} from "./folderService.js";
export { paperRecordFromMetadata, parsePaperMetadata } from "./paperMetadata.js";
export type { PaperLocation } from "./paperMetadata.js";
