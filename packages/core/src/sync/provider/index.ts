/**
 * Barrel re-export for sync/provider public symbols.
 *
 * @depends remoteProvider, authProvider, remotePathResolver
 * @dependents sync/index, sync/core/*, sync/drive/*
 */
export type {
  RemoteNamespace,
  RemoteFile,
  RemoteProvider,
} from "./remoteProvider.js";
export type { IAuthProvider } from "./authProvider.js";
export { RemotePathResolver, splitPath } from "./remotePathResolver.js";
