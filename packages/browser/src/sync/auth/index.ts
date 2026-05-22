/**
 * Barrel for the browser Drive auth module.
 * @depends browserDriveAuth, tokenStore
 * @dependents background, sync/browserSyncController (Phase 4)
 */
export { BrowserDriveAuth } from "./browserDriveAuth";
export { loadToken, saveToken, clearToken } from "./tokenStore";
export type { StoredToken } from "./tokenStore";
