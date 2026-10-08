/**
 * Public API of the browser storage layer.
 */
export { IndexedDbFileSystem } from "./indexedDbFileSystem";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  upsertRecord,
  deleteRecord,
  getRecord,
  listAllRecords,
  rebuildFromFiles,
} from "./paperRecordStore";
export {
  buildFolderTree,
  pdfDirsFromKeys,
  scanLibrary,
  pdfDirs,
} from "./folderTreeStore";
export type { FolderNode } from "./folderTreeStore";
export { getDb } from "./idb/db";
export type { FileRow, MetadataRow, ManifestRow, LabShelfSchema } from "./idb/schema";
