# Contract: PDF reader and its hosts

The PDF reader is one UI that runs inside two hosts: the VS Code webview and a browser extension page. Hosts own persistence, clipboard, files, external links and settings. The reader owns everything on screen. They talk only through the typed message protocol in the reader's `protocol` module, which is the single source of truth for message shapes.

## Startup

1. The host serves the HTML shell (shared by both hosts) with an inert JSON boot block, `ReaderBootParams`. The block carries the protocol version, asset URLs, paper id and title, theme preference and effective theme, reader preferences and `isMac`.
2. The host's entry calls `startReader({ boot, transport, perf, pdf? })`. The transport hides how messages travel: `postMessage` in VS Code, in-page calls in the browser. `pdf` lets a host supply the paper bytes and the worker. The browser starts workers from the extension URL, because Firefox refuses `blob:` workers.
3. The reader sends `ready-for-init`. The host answers `init` with the reading state, annotations, preferences and theme.
4. The reader sends `ready` with the page count once the document is laid out.

## Rules

- **Every message is handled by every host.** Adding a message means adding its handler to the VS Code host and to the browser host in the same change.
- **The host validates untrusted input.** Messages from the reader go through `isWebviewMessage`, so a malformed message is rejected and never half-applied. External links go through `isSafeExternalUrl`, which allows only `http:`, `https:` and `mailto:`, so a crafted PDF cannot open `file:`, `command:` or `vscode:` URIs.
- **Preferences are validated once.** Both hosts pass stored preferences through the shared `normalizeReaderPrefs`. VS Code reads them from settings; the browser reads them from extension storage.
- **The sidecar format is shared.** The host persists annotations, theme and reading position through the shared `PaperDataStore` over a `SidecarPort`, which keeps the bytes identical everywhere ([library-format.md](library-format.md#sidecar-datajson)).
- **Reading position is saved only after restore.** The reader does not report a position until it has restored the stored one, so the initial page-1 layout never overwrites it.
- **`PROTOCOL_VERSION` changes whenever a message changes shape.**

## Host-specific constraints

| Host | Constraint |
|---|---|
| VS Code | strict webview CSP with a nonce; assets through `asWebviewUri`; default webview CSS and theme variables are injected by VS Code |
| Browser | MV3 forbids inline scripts; the manifest needs `'wasm-unsafe-eval'` for pdf.js; minimum versions are Chrome 125 and Firefox 128 (the pdf.js 6.3 floor); the reader page never loads the library page's `base.css` |
