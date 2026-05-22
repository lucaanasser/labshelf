/**
 * Cross-platform authentication contract used by RemoteProvider implementations.
 *
 * VS Code's GoogleDriveAuth (PKCE loopback + vscode.SecretStorage) and the
 * browser's BrowserDriveAuth (chrome.identity.launchWebAuthFlow + bx.storage)
 * both implement this interface, so the same RemoteProvider class runs on
 * both surfaces.
 *
 * @depends none
 * @dependents sync/drive/googleDriveProvider
 */
export interface IAuthProvider {
  /** Returns true when valid credentials are held in memory. */
  isAuthenticated(): boolean;
  /** Returns a valid access token, refreshing first if needed. */
  getAccessToken(): Promise<string>;
  /** Runs the authentication flow and persists credentials. */
  authenticate(): Promise<void>;
  /** Revokes credentials and clears any persisted state. */
  revoke(): Promise<void>;
}
