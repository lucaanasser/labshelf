/**
 * Public surface of the VS Code sync layer — auth and adapters that stay
 * platform-specific. Provider, engine, manifest, and util types come from
 * @labshelf/core directly.
 *
 * @depends auth, adapter
 * @dependents extension (indirect)
 */
export { GoogleDriveAuth } from "./auth/googleDriveAuth.js";
export { VscodeLocalFileSystem } from "./adapter/vscodeLocalFileSystem.js";
export { SyncController } from "./adapter/syncController.js";
