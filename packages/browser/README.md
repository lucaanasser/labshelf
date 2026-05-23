# @labshelf/browser

LabShelf as a Chromium + Firefox MV3 WebExtension. Captures papers from any
tab, stores everything locally in IndexedDB, and syncs with the same
`LabShelf Library/` folder on Google Drive that the VS Code extension uses.

## Prerequisites

- Node 18+, pnpm 9 (same as the root monorepo).
- A Google Cloud project with the **Drive API** enabled.
- An OAuth 2.0 **Web application** client whose authorised redirect URIs
  include both:
  - `https://<your-chrome-extension-id>.chromiumapp.org/`
  - `https://<your-firefox-extension-hash>.extensions.allizom.org/`

The redirect URI is selected at runtime via `bx.identity.getRedirectURL()`;
both Chromium and Firefox use the same client ID. No client secret is needed —
the implicit `response_type=token` flow is used.

## OAuth client setup

1. Copy `src/sync/auth/oauthConfig.example.ts` to
   `src/sync/auth/oauthConfig.ts`.
2. Paste the OAuth client ID from the Google Cloud Console into `CLIENT_ID`.
3. Keep `SCOPES` as `drive.file` + `drive.appdata` so the extension shares the
   manifest with the VS Code extension via `appDataFolder`.
4. `oauthConfig.ts` is gitignored — never commit it.

## Build

From the repo root:

```bash
pnpm install
pnpm --filter @labshelf/browser build
```

This produces two distributables:

```
packages/browser/dist/
  chrome/    — load via chrome://extensions → "Load unpacked"
  firefox/   — load via about:debugging → "Load Temporary Add-on" → select manifest.json
```

Single-target builds:

```bash
pnpm --filter @labshelf/browser build:chrome
pnpm --filter @labshelf/browser build:firefox
```

## Loading the extension

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select `packages/browser/dist/chrome`.
4. Pin the LabShelf icon to the toolbar.

### Firefox

1. Open `about:debugging`.
2. Click **This Firefox → Load Temporary Add-on**.
3. Select `packages/browser/dist/firefox/manifest.json`.

The temporary add-on is removed when Firefox restarts. For development, use
`pnpm --filter @labshelf/browser lint:manifest` to validate the bundle before
distribution.

## Connecting to Google Drive

1. Click the LabShelf toolbar icon to open the popup.
2. Click **Connect to Drive**. The browser opens the Google consent screen.
3. After consent the popup status changes to **DRIVE SYNCED** and the
   **Sync now** button is enabled.
4. The token is stored in `bx.storage.local` only — never synced.

To disconnect, open the **Settings** link in the popup footer and use the
**Disconnect from Drive** button in the *DRIVE CONNECTION* section.

## Day-to-day usage

| Action | Where |
|---|---|
| Capture the current tab as a paper | toolbar popup → **Save current page** |
| Open the full library UI | toolbar popup → **Open library** |
| Manual sync | toolbar popup → **Sync now** |
| Change auto-sync interval | options page → **SYNC** section |
| Disable auto-sync | options page → set interval to `0` |
| Toggle the Sci-Hub fallback | options page → **PDF RESOLUTION** |
| Inspect recent activity | options page → **RECENT LOG** |

Auto-sync also runs when the browser becomes idle (≥5 min) and 30 s after any
local mutation (capture, folder rename, paper status change, delete).

## Toolbar badge states

| Badge | Meaning |
|---|---|
| (empty) | Disconnected, or freshly connected with nothing pending |
| dim dot | Connected, idle |
| `.` `..` `...` (blue) | Sync in flight |
| `!` (red) | Last sync failed — hover the icon for the error |

## Scripts

```bash
pnpm --filter @labshelf/browser build           # build both targets
pnpm --filter @labshelf/browser build:chrome    # chrome only
pnpm --filter @labshelf/browser build:firefox   # firefox only
pnpm --filter @labshelf/browser typecheck       # tsc --noEmit
pnpm --filter @labshelf/browser lint:manifest   # web-ext lint on dist/firefox
```

## Specs

Detailed feature specs live under [`documents/specs/browser/`](../../documents/specs/browser/):

- `browser-shell.spec.yaml` — MV3 layout, build, runtime messages
- `auth.spec.yaml` — Drive OAuth flow
- `local-storage.spec.yaml` — IndexedDB schema and adapters
- `sync.spec.yaml` — sync controller, schedulers, badge, debouncer
- `capture.spec.yaml` — DOI/arXiv/PDF detection and resolver chain
- `library-page.spec.yaml` — standalone library UI
