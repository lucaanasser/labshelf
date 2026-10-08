/**
 * Google OAuth credentials template for the terminal app.
 *
 * The terminal must use the same "Desktop app" OAuth client as the VS Code extension: Drive's drive.file scope only
 * shows an app the files created by its own Google Cloud project, so a different project would see an empty library.
 * `pnpm build` copies packages/vscode/src/sync/auth/googleDriveCredentials.ts here when this file's real copy
 * (googleDriveCredentials.ts, gitignored) is missing. LABSHELF_GOOGLE_CLIENT_ID / LABSHELF_GOOGLE_CLIENT_SECRET
 * override both at run time.
 */
export const CLIENT_ID = 'YOUR_GOOGLE_OAUTH_CLIENT_ID';
export const CLIENT_SECRET = 'YOUR_GOOGLE_OAUTH_CLIENT_SECRET';
