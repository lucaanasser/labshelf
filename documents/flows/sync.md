# Sync Flow

This page describes in plain language how the LabShelf synchronization system works, from authentication to conflict resolution.

## Local-to-Drive mapping

Google Drive exposes two distinct namespaces for applications. LabShelf uses both.

The **library** namespace is a regular folder created at the root of the user's Drive and is visible in the Google Drive web interface. It contains the paper files: each subfolder corresponds to one paper and holds the `paper.pdf`, the `metadata.yaml`, and the `bib.bib`. The user can browse this folder normally.

The **appdata** namespace uses the Drive `appDataFolder` endpoint, which creates a hidden private area that is invisible in the Drive interface. LabShelf stores the sync manifest and the `data.json` annotation and theme files there. Those files have no meaning outside the extension context and should not be visible to the user.

The local SQLite database and the state file at `.research/sync/<providerId>.state.json` are never uploaded to Drive. SQLite is a rebuildable cache; the sync state is specific to the local machine.

## OAuth PKCE authentication flow

Google Drive requires OAuth 2.0. LabShelf uses the PKCE flow with a loopback server, which does not require a client secret stored in the extension.

1. The user runs the command `labshelf.sync.connect`.
2. `GoogleDriveAuth` generates a random code verifier and computes the corresponding code challenge (SHA-256, base64url).
3. The extension opens a local HTTP server on an ephemeral port, for example `http://localhost:52341`.
4. The user's browser opens with the Google authorization URL, including the `redirect_uri` pointing to the local server and the `code_challenge`.
5. The user logs into Google and approves the requested permissions.
6. Google redirects the browser to the local server with the authorization code in the query string.
7. The local server captures the code, closes the connection, and shuts down the listener.
8. `GoogleDriveAuth` exchanges the code for a token pair (access token + refresh token) using the original code verifier.
9. The tokens are stored via `vscode.ExtensionContext.secrets`, which keeps them encrypted in the operating system keychain.
10. The status bar is updated to reflect the connected state.

If the user closes the browser or cancels before authorizing, the local server expires without receiving a code and the extension displays a message informing the user that authentication was cancelled.

## Bidirectional sync flow

When a sync is triggered, `SyncController` calls `SyncEngine`, which executes the following steps in order.

**Load the manifest.** `SyncManifest` reads the file `.research/sync/<providerId>.state.json`. This file records the state of each file at the last successful sync: relative path, content hash, and timestamp. If the file does not exist, the manifest is treated as empty and sync continues normally. If the JSON is corrupted, the same fallback applies and a warning is logged.

**Scan local state.** The engine traverses the `papers/` folder and the `data.json` files in `.research/papers/`, computing the hash of each file found.

**Scan remote state.** The engine calls `RemoteProvider.listFiles()`, which returns the list of files with their hashes and metadata.

**Compute the diff.** For each file present in any of the three sets (manifest, local, remote), the engine determines the correct action. See the next section for details on the 8 possible actions.

**Apply the actions.** The engine performs the required uploads, downloads, deletes, and renames by calling methods on `RemoteProvider` and the local filesystem.

**Save the updated manifest.** After applying all actions without a fatal error, `SyncManifest` writes the new state to disk.

## Three-way diff

The diff compares three sources for each file: the manifest (previously agreed state), the current local state, and the current remote state. The eight possible actions are as follows.

**local-new**: the file exists locally but was not in the manifest and does not exist remotely. Conclusion: it was added locally. Action: upload to Drive.

**remote-new**: the file exists remotely but was not in the manifest and does not exist locally. Conclusion: it was added on another device. Action: download to local disk.

**local-modified**: the local hash differs from the manifest, but the remote hash matches the manifest. Conclusion: it was edited locally since the last sync. Action: upload, overwriting the remote file.

**remote-modified**: the remote hash differs from the manifest, but the local hash matches the manifest. Conclusion: it was edited on another device. Action: download, overwriting the local file.

**local-deleted**: the file was in the manifest but no longer exists locally, and the remote matches the manifest. Conclusion: it was deleted locally. Action: delete on Drive.

**remote-deleted**: the file was in the manifest but no longer exists remotely, and the local matches the manifest. Conclusion: it was deleted on another device. Action: delete locally.

**conflict**: both the local hash and the remote hash differ from the manifest. Conclusion: the file was modified on both sides since the last sync. Action: keep-both. The remote file is renamed with the suffix `(conflict <date>)` before the local file is uploaded. The user ends up with both versions and can resolve manually.

**unchanged**: local and remote hashes both match the manifest. No action needed.

## Auto-sync

Sync can be triggered in three ways.

**Library events.** `SyncController` listens to the events `paper:added`, `paper:deleted`, `paper:updated`, `annotation:created`, `annotation:updated`, and `annotation:deleted` emitted by `EventBus`. Each event resets a 30-second debounce timer. This prevents triggering a sync for every file in a batch import: sync only occurs 30 seconds after the last event in the burst.

**Periodic polling.** On startup, `SyncController` sets up a `setInterval` using the value of `labshelf.sync.autoSyncIntervalMinutes`. The default interval is defined in the extension configuration. The interval is only active when there is an authenticated session.

**Manual command.** The user can run `labshelf.sync.now` at any time via the command palette or by clicking the status bar item.

## How to add a new provider

The `RemoteProvider` interface defines the contract that any sync backend must implement. To add a new provider, such as GitHub or Dropbox, follow these steps.

**Implement the interface.** Create a class that implements `RemoteProvider`. The required methods are `listFiles()`, `uploadFile()`, `downloadFile()`, and `deleteFile()`. The `listFiles()` method must return the list of files with enough hash and metadata for `SyncEngine` to compute the diff. The `uploadFile()` method must accept content as bytes and the relative path in the remote namespace.

**Implement authentication.** Create an auth class equivalent to `GoogleDriveAuth`. It must store tokens via `vscode.ExtensionContext.secrets` so that tokens survive VS Code restarts without exposing secrets in the code.

**Register in SyncController.** `SyncController` instantiates the active provider. Add a condition that selects the new provider based on the user's configuration, for example a new value in the `labshelf.sync.provider` setting.

**Write tests.** Mock the new provider the same way `GoogleDriveProvider` is tested: replace `fetch` with a mock that returns controlled responses and verify that the 8 diff actions produce the correct behavior.
