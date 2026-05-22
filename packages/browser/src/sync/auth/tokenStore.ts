/**
 * Persists the Google Drive access token in `bx.storage.local`. We deliberately
 * avoid `bx.storage.sync` so the token never leaves the local profile.
 *
 * The implicit OAuth flow used by the browser shell does not return a refresh
 * token — instead we record the absolute expiration time and let
 * BrowserDriveAuth re-run a silent `launchWebAuthFlow({ interactive: false })`
 * before the access token expires.
 *
 * @depends platform/browserApi
 * @dependents sync/auth/browserDriveAuth
 */
import { bx } from "../../platform/browserApi";

const STORAGE_KEY = "labshelf.gdrive.token";

export interface StoredToken {
  accessToken: string;
  expiryMs: number;
  scope: string;
}

export async function loadToken(): Promise<StoredToken | null> {
  const stored = await bx.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<StoredToken>;
  if (typeof t.accessToken !== "string" || typeof t.expiryMs !== "number" || typeof t.scope !== "string") {
    return null;
  }
  return { accessToken: t.accessToken, expiryMs: t.expiryMs, scope: t.scope };
}

export async function saveToken(token: StoredToken): Promise<void> {
  await bx.storage.local.set({ [STORAGE_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await bx.storage.local.remove(STORAGE_KEY);
}
