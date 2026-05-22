/**
 * Google OAuth client IDs for the browser extension. Copy this file to
 * `oauthConfig.ts` (same directory) and fill in the real values from the
 * Google Cloud Console. `oauthConfig.ts` is gitignored — never commit it.
 *
 * Two clients are needed because Chrome and Firefox use different OAuth client
 * types in the Google Cloud Console:
 *   - Chrome: "Chrome Extension" client (uses the extension ID directly).
 *   - Firefox: "Web application" client with the chromiumapp.org redirect URI
 *     pre-registered (the polyfill emulates the same redirect on Firefox).
 *
 * Both clients are public — no client secret is shipped with the browser
 * because the implicit / `response_type=token` flow does not require one.
 *
 * @depends none
 * @dependents browserDriveAuth
 */
export const CLIENT_ID_CHROME = "YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID.apps.googleusercontent.com";
export const CLIENT_ID_FIREFOX = "YOUR_FIREFOX_WEB_APP_OAUTH_CLIENT_ID.apps.googleusercontent.com";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];
