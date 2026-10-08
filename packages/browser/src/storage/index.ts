/**
 * Barrel re-export for the storage layer.
 * @depends indexedDbFileSystem, paperRecordStore, folderTreeStore, idb/db, idb/schema
 * @dependents sync/browserSyncController (Phase 4), library-page (Phase 6)
 */
export { IndexedDbFileSystem } from "./indexedDbFileSystem";
export {
  upsertRecord,
  deleteRecord,
  getRecord,
  listAllRecords,
  rebuildFromFiles,
  recordFromYaml,
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
