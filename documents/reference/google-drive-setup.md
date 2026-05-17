# Google Drive OAuth Client Setup

This page covers how to update the OAuth client credentials used by the sync feature, how to test the authentication flow manually, and notes on token storage and the unverified app warning.

## OAuth client credentials

The extension uses a standard OAuth 2.0 Authorization Code + PKCE loopback flow. The credentials are kept out of source control. They live in `packages/vscode/src/sync/auth/googleDriveCredentials.ts`, which is gitignored. A template `googleDriveCredentials.example.ts` is committed alongside it.

To set up credentials locally, copy `googleDriveCredentials.example.ts` to `googleDriveCredentials.ts` (same directory) and fill in the values from the Google Cloud Console.

### How to update the Client ID and Client Secret

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select the LabShelf project.
2. Go to **APIs & Services → Credentials**.
3. Open the OAuth 2.0 Client ID of type **Desktop app** (or create one if it does not exist).
4. Copy the new Client ID and Client Secret.
5. Copy `googleDriveCredentials.example.ts` to `googleDriveCredentials.ts` and fill in the values from the Google Cloud Console (this file is gitignored — never commit it).
6. Make sure the following **Authorized redirect URIs** are listed on the client:
   - `http://127.0.0.1` (the loopback server uses a random ephemeral port, so only the host is checked by the loopback flow; the port is included at runtime via `redirect_uri` in the request)
7. Save the client and rebuild the extension.

### Required scopes

The extension requests two scopes:

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/drive.file` | Read and write files created by the app in the user's Drive (the `library/` folder) |
| `https://www.googleapis.com/auth/drive.appdata` | Read and write the hidden `appDataFolder` namespace (sync manifest, annotations, theme data) |

Both scopes must be enabled under **APIs & Services → OAuth consent screen → Scopes**.

---

## Manual testing steps

1. Run the extension in the **Extension Development Host** (`F5` in VS Code).
2. Open the command palette and run **LabShelf: Connect to Google Drive** (`labshelf.sync.connect`).
3. A browser tab opens with the Google OAuth consent screen.
4. Sign in with a Google account and approve the requested scopes.
5. The browser should show the plain-text confirmation message and the extension status bar item should update to reflect the connected state.
6. Run **LabShelf: Sync Now** (`labshelf.sync.now`) to trigger a full sync cycle.
7. Verify that files appear in the user's Google Drive under the `LabShelfLibrary` folder.
8. To test disconnect, run **LabShelf: Disconnect from Google Drive** (`labshelf.sync.disconnect`). Tokens are revoked and deleted from secret storage.

### Testing cancellation

Close the browser tab before approving. The loopback server waits for the authorization code and times out; the extension should display a cancellation message without leaving any partial state.

---

## Token and secret storage

Tokens (access token + refresh token) are stored with `vscode.ExtensionContext.secrets` under the key `labshelf.gdrive.tokens`. This API encrypts the value in the OS keychain (Keychain Access on macOS, libsecret on Linux, Windows Credential Manager on Windows).

- Tokens are **never** written to disk as plain text.
- Tokens are **never** committed to the repository.
- The refresh token survives VS Code restarts; the access token is refreshed automatically 60 seconds before expiry.
- To clear tokens manually during development, run the disconnect command or delete the `labshelf.gdrive.tokens` entry from the OS keychain.

---

## Unverified app warning

Because the OAuth consent screen is in **Testing** mode (not published), Google displays an "unverified app" interstitial when a user signs in. This is expected during development.

To proceed past the warning:
1. Click **Advanced** on the interstitial.
2. Click **Go to LabShelf (unsafe)**.

To remove the warning for a production release:
1. Complete the Google OAuth verification process under **APIs & Services → OAuth consent screen → Publish App**.
2. Provide a privacy policy URL and comply with Google's review requirements.
3. Once approved, the warning disappears for all users.

During testing, you can also add specific Google accounts as **Test users** under the OAuth consent screen. Those accounts skip the warning entirely.
