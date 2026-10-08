/**
 * Barrel re-export for all sync/core public symbols.
 *
 * @depends syncTypes, syncManifest, treeScan, syncDiff, syncApply, syncEngine, folderNames, libraryFolderNamer, syncLock, syncRunRecord
 * @dependents sync/index, downstream sync controllers
 */
export type {
  ManifestEntry,
  ManifestData,
  DiffClass,
  TreeNode,
  SyncOperation,
  NamespaceResult,
  SyncResult,
  LocalStat,
  LocalFileSystem,
} from "./syncTypes.js";
export { SyncManifest } from "./syncManifest.js";
export { scanLocalTree, scanRemoteTree } from "./treeScan.js";
export type { RemoteFolderNamer } from "./treeScan.js";
export { createLibraryFolderNamer, isSafeFolderName } from "./libraryFolderNamer.js";
export type { LibraryFolderNamerDeps } from "./libraryFolderNamer.js";
export { diffNamespace } from "./syncDiff.js";
export { applyOperations } from "./syncApply.js";
export type { ApplyContext } from "./syncApply.js";
export { SyncEngine } from "./syncEngine.js";
export type { SyncEngineDeps, NamespaceRoots, FolderNameMaps } from "./syncEngine.js";
export { buildLibraryFolderNames, driveFolderName } from "./folderNames.js";
export { SyncLock, parseSyncLock } from "./syncLock.js";
export type { LockStore, SyncLockOwner, SyncLockInfo, SyncLockOptions, SyncLockAttempt } from "./syncLock.js";
export { summarizeSyncResult, writeSyncRunRecord, readSyncRunRecord } from "./syncRunRecord.js";
export type { SyncRunRecord } from "./syncRunRecord.js";
