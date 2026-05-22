/**
 * Google OAuth client ID for the browser extension. Copy this file to
 * `oauthConfig.ts` (same directory) and fill in the real value from the
 * Google Cloud Console. `oauthConfig.ts` is gitignored — never commit it.
 *
 * A single "Web application" client covers both Chrome and Firefox:
 *   - Register https://<chrome-ext-id>.chromiumapp.org/ as a redirect URI.
 *   - Register https://<firefox-hash>.extensions.allizom.org/ as a redirect URI.
 * The redirect URI is selected automatically at runtime via
 * `bx.identity.getRedirectURL()`, which returns the correct value per browser.
 * No client secret is needed — the implicit `response_type=token` flow is used.
 *
 * @depends none
 * @dependents browserDriveAuth
 */
export const CLIENT_ID = "YOUR_WEB_APP_OAUTH_CLIENT_ID.apps.googleusercontent.com";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];
