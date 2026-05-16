/** Barrel re-export for sync/provider public symbols. @depends remoteProvider, remotePathResolver. @dependents sync/index, syncApply, syncEngine, treeScan */
export type {
  RemoteNamespace,
  RemoteFile,
  RemoteProvider,
} from "./remoteProvider.js";
export { RemotePathResolver, splitPath } from "./remotePathResolver.js";
