/**
 * Module: Sync (barrel)
 * Responsibility: Public surface of the provider-agnostic sync layer
 * Dependencies: sync submodules
 */
export type {
  RemoteProvider,
  RemoteFile,
  RemoteNamespace,
} from "./remoteProvider.js";
export type {
  LocalFileSystem,
  LocalStat,
  ManifestData,
  ManifestEntry,
  DiffClass,
  TreeNode,
  SyncOperation,
  NamespaceResult,
  SyncResult,
} from "./syncTypes.js";
export { SyncManifest } from "./syncManifest.js";
export { diffNamespace } from "./syncDiff.js";
export { applyOperations } from "./syncApply.js";
export type { ApplyContext } from "./syncApply.js";
export { RemotePathResolver, splitPath } from "./remotePathResolver.js";
export { conflictPath, isoDate } from "./conflictName.js";
export { sha256Hex } from "./contentHash.js";
export { scanLocalTree, scanRemoteTree } from "./treeScan.js";
export { SyncEngine } from "./syncEngine.js";
export type { SyncEngineDeps, NamespaceRoots } from "./syncEngine.js";
export { DriveClient } from "./googleDriveClient.js";
export type { DriveFile, DriveFileList } from "./googleDriveClient.js";
export { GoogleDriveAuth } from "./googleDriveAuth.js";
export { GoogleDriveProvider, createGoogleDriveProvider } from "./googleDriveProvider.js";
