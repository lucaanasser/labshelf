# Apps: setup and verification

This folder explains how to build, run and verify each app. App-specific details are in [vscode.md](vscode.md), [browser.md](browser.md) and [terminal.md](terminal.md).

## Prerequisites

- Node.js 22.13 or later (needed by `node:sqlite` and pdf.js), and pnpm 9 or later.
- `pnpm install` at the repository root.

## Google OAuth clients

Drive sync needs OAuth clients from one Google Cloud project, because an app only sees, through the Drive scopes, the files created by its own project ([contracts/sync.md](../contracts/sync.md#namespaces-on-drive)).

| Client type | Used by | Local file (gitignored; copy the committed `.example`) |
|---|---|---|
| Desktop | VS Code and the terminal | `packages/vscode/src/sync/auth/googleDriveCredentials.ts`; the terminal build copies it when its own copy is missing |
| Web application | browser | `packages/browser/src/sync/auth/oauthConfig.ts` |

To set them up in Google Cloud Console:

1. Enable the Drive API.
2. Add the scopes `drive.file` and `drive.appdata` to the consent screen.
3. Create the Desktop client. Its redirect URI is the loopback `http://127.0.0.1`; the port is chosen at run time.
4. Create the Web client. Its redirect URIs are `https://<chrome-extension-id>.chromiumapp.org/` and `https://<firefox-hash>.extensions.allizom.org/`. To find them, run `browser.identity.getRedirectURL()` in the extension's console.

While the consent screen is in Testing mode, Google shows an "unverified app" warning. Add your accounts as test users, or click Advanced → Go to LabShelf.

## Verifying changes

Unit tests do not cover webview DOM, the real extension host or a real terminal. After a change in one of those areas, verify it for real, following the recipe in the app's document:

| Change | Recipe |
|---|---|
| import, OCR, text layer, anything pdf.js does in the extension host | [vscode.md → extension host run](vscode.md#extension-host-run) |
| webview or reader UI, list panel | [vscode.md → webview harness](vscode.md#webview-harness) |
| browser extension pages, popup, capture | [browser.md → headless run](browser.md#headless-run) |
| TUI layout, keys, terminal output | [terminal.md → verification](terminal.md#verification) |

Rules for every recipe:

- **Never run against the user's real library.** Use a copy: `cp -R ~/Documents/LabShelfLibrary <scratch>/lib`.
- **Isolate config and tokens.** Point `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` at scratch directories, and use a throwaway `--user-data-dir`.
- **Use a real paper as well as synthetic fixtures.** Synthetic PDFs miss real-world failures: OCR layers, scans, margin stamps, missing link annotations.
- **Look at the screenshots.** A passing DOM assertion does not prove the layout is right.
- Harness scripts live in the session scratchpad and are not committed.
- On this Mac, `/Applications/Google Chrome.app` crashes in headless mode. Use Playwright's Chrome for Testing or its headless shell from `~/Library/Caches/ms-playwright/`, launched outside the sandbox.
