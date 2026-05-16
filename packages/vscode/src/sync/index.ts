/**
 * Module: Sync (root barrel)
 * Responsibility: Public surface of the sync layer — re-exports all public
 *   symbols from the six subdirectories
 */
export type {
  RemoteProvider,
  RemoteFile,
  RemoteNamespace,
} from "./provider/index.js";
export { RemotePathResolver, splitPath } from "./provider/index.js";

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
} from "./core/index.js";
export { SyncManifest } from "./core/index.js";
export { diffNamespace } from "./core/index.js";
export { applyOperations } from "./core/index.js";
export type { ApplyContext } from "./core/index.js";
export { scanLocalTree, scanRemoteTree } from "./core/index.js";
export { SyncEngine } from "./core/index.js";
export type { SyncEngineDeps, NamespaceRoots, FolderNameMaps } from "./core/index.js";

export { DriveClient } from "./drive/index.js";
export type { DriveFile, DriveFileList } from "./drive/index.js";
export { GoogleDriveProvider, createGoogleDriveProvider } from "./drive/index.js";

export { GoogleDriveAuth } from "./auth/index.js";

export { sha256Hex } from "./util/index.js";
export { conflictPath, isoDate } from "./util/index.js";

export { VscodeLocalFileSystem } from "./adapter/index.js";
export { SyncController } from "./adapter/index.js";
