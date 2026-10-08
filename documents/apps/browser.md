# Browser extension

A Chrome and Firefox MV3 extension. It captures papers from any tab or from Google Scholar, keeps its own copy of the library in IndexedDB, reads PDFs with the same reader as VS Code, and meets the other apps on Drive ([contracts/sync.md](../contracts/sync.md)).

## Build

```bash
pnpm --filter @labshelf/browser build            # both targets → dist/chrome, dist/firefox
pnpm --filter @labshelf/browser build:chrome
pnpm --filter @labshelf/browser build:firefox
pnpm --filter @labshelf/browser lint:manifest    # web-ext lint on dist/firefox
```

- Before the first build, copy `src/sync/auth/oauthConfig.example.ts` to `oauthConfig.ts` and set the Web client id ([README.md](README.md#google-oauth-clients)).
- One source tree builds both targets. Only the manifest differs: Chrome uses a `service_worker`, and Firefox uses `background.scripts` plus the gecko id `labshelf@lucanaasser.dev`.
- pdf.js is vendored from the `pdfjs-dist` legacy build into `vendor/pdfjs/`. `pdf_viewer.mjs` is lowered to es2023 so that `web-ext lint` passes.

## Load

| Browser | How |
|---|---|
| Chrome / Chromium 125+ | `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome` |
| Firefox 128+ (temporary) | `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`, or `pnpm --filter @labshelf/browser dev:firefox` |
| Firefox (permanent) | Developer Edition, Nightly or ESR with `xpinstall.signatures.required=false` and `package:firefox`; for release Firefox, sign it unlisted with `web-ext sign --channel=unlisted` |

The minimum versions are the floor for pdf.js 6.3.

## Platform constraints

- MV3 forbids inline scripts. The theme is applied before first paint by a separate classic script in `<head>`, with the preference stored in `localStorage["labshelf.theme"]`.
- The extension pages' CSP is `script-src 'self' 'wasm-unsafe-eval'`, which pdf.js needs for its WebAssembly decoders.
- Firefox refuses `blob:` workers, so the pdf.js worker starts from its extension URL.
- The Scholar content script renders inside a shadow root and loads the tokens as text, with `:root` rewritten to `:host`.
- Cloudflare-protected publishers (ACM, SIAM, ScienceDirect) block headless browsers and plain `fetch`. Real downloads from them can only be tested by hand.

## Headless run

Playwright's full Chrome for Testing can load the unpacked extension. Run it outside the sandbox:

```bash
"~/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --headless=new --load-extension=<repo>/packages/browser/dist/chrome \
  --disable-extensions-except=<same> --remote-debugging-port=0 --user-data-dir=<scratch>
```

- The DevTools port is in `<user-data-dir>/DevToolsActivePort`. Node has a global `WebSocket`, so the DevTools protocol can be driven without dependencies.
- Pick the extension's service worker by `url.endsWith("/background/index.js")`. Chrome for Testing ships a component extension whose worker comes first. Read `chrome.storage.local` by evaluating in that worker.
- To test a page without the background, serve `dist/chrome` statically and inject a callback-style `window.chrome` stub (webextension-polyfill needs only `runtime.id`). Seed IndexedDB `labshelf` v1 on the same origin before navigating to `library-page/index.html`.
- To test the Scholar content script on a fixture, `Fetch.enable` for `https://scholar.google.com/scholar*` and fulfil the request with the fixture HTML.
- To test the popup against an article tab, open `popup/index.html` in a 340 px target, overriding `chrome.tabs.query` through `Page.addScriptToEvaluateOnNewDocument`.
- For reader parity with VS Code, render both readers on the same real paper and pixel-diff the toolbar and sidebar. CDP drags do not create text selections in either reader; select with a `Range` plus a synthetic `mouseup` instead.
