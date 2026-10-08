# Architecture

> The code is being moved into this layout by [plans/architecture-refactor.plan.md](plans/architecture-refactor.plan.md). Until that plan is done, the plan lists where the code still differs from this document. Delete this note when the plan is done.

## Packages

```
packages/
  core/       @labshelf/core      everything more than one app can use
  vscode/     @labshelf/vscode    VS Code extension: wiring and VS Code-only code
  browser/    @labshelf/browser   Chrome/Firefox MV3 extension: wiring and browser-only code
  terminal/   @labshelf/terminal  `labshelf` TUI and CLI: wiring and terminal-only code
website/                          public site about LabShelf; not part of the product
```

Dependencies point one way: each app depends on `core`, and nothing depends on an app. Apps never import each other. The website may use core's design tokens and icons and nothing else.

## What an app contains

An app contains only two kinds of code:

1. **Wiring.** The composition root that builds core services with the app's adapters, registration of commands, views and pages, and the translation of UI events into core calls.
2. **Code that cannot exist anywhere else:**
   - VS Code: `vscode` API usage (activation, commands, tree views, webview panels, `SecretStorage`, settings), `node:sqlite` and the index database, Tesseract OCR, the ONNX embedding runtime.
   - Browser: manifests, the background service worker, content scripts, `chrome.*`/`browser.*` APIs, IndexedDB adapters, the popup and options pages, the helper-tab PDF fetch.
   - Terminal: raw TTY input and screen, kitty/iTerm2 images, CLI argument parsing, keychain token storage, the system clipboard, opener and trash.

Anything else that two apps need moves to `core`, even if only one app uses it today but another plausibly will.

## Core

Core is organised by domain. Inside a domain, code is split by the runtime it needs:

```
core/src/<domain>/
  *.ts        runtime-neutral: ES2022 plus fetch, URL, TextEncoder, crypto.subtle. No node:*, no DOM.
  node/       may use node:* (consumed by vscode and terminal)
  dom/        may use the DOM (consumed by VS Code webviews and browser pages)
```

The package exposes three entry points that match these runtimes: `@labshelf/core`, `@labshelf/core/node` and `@labshelf/core/dom`. Stylesheets are exported as `@labshelf/core/styles/*`. Separate tsconfigs (neutral code without the DOM and Node libs) and an import-boundary lint make a violation fail the build.

Domains:

| Domain | Owns |
|---|---|
| `model/` | shared types and their runtime value lists: paper record, statuses, annotations, themes, colours, log entry |
| `ports/` | the interfaces apps implement: file system, local tree, lock store, sidecar port, logger, auth, clock |
| `library/` | the library format ([contracts/library-format.md](contracts/library-format.md)): layout paths, `metadata.yaml` ⇄ record, cite keys, tags, folder names, the folder tree, library mutations (move, rename, trash, update fields), the in-memory store with sort and filter, the search query language, fuzzy matching, shared config; `node/` has the Node file system, atomic writes and the scanner adapter |
| `import/` | everything that turns an input into a paper: identifier detection, PDF text and metadata extraction, metadata registries (CrossRef, arXiv, Semantic Scholar…), resolution and merge, landing-page parsing, the PDF resolver chain and download, BibTeX; `node/` has the pdfjs opener for Node |
| `sync/` | the sync engine, Drive provider, lock, run record, folder naming, and the sync coordinator (debounce, periodic runs, lock handling) every app drives ([contracts/sync.md](contracts/sync.md)); `node/` has the lock store, the local tree adapter and the PKCE loopback auth shared by VS Code and the terminal |
| `reader/` | the PDF reader: protocol, sidecar data store, reading state, preferences, citation formats, pure logic, and the host controller that answers reader messages for every host ([contracts/reader-host.md](contracts/reader-host.md)); `dom/` has the reader UI and its styles |
| `library-ui/` | the library surface shared by the VS Code list panel and the browser library page: list state, list, detail pane, folder header and chips; `dom/` holds the components |
| `ui/` | the design system: tokens, base styles, components (button, menu, dialog, toast, quick input), icons |
| `ai/` | embeddings contracts, chunking, retrieval, heuristics; runtimes stay in the VS Code app |
| `logging/` | the JSON-lines log format and a logger over a port |

Each domain folder has an `index.ts`. Inside a domain, related files are grouped in subfolders once there are more than eight (for example `import/registries/`, `reader/dom/sidebar/`).

## Ports and composition roots

Core never reaches the platform directly. It declares a port, and each app implements it:

| Port | VS Code | Browser | Terminal |
|---|---|---|---|
| file system / local tree | `vscode.workspace.fs` adapter | IndexedDB | core `node/` |
| lock store | core `node/` | none (one browser, no shared folder) | core `node/` |
| sidecar port | core `node/` | IndexedDB | core `node/` |
| auth | core `node/` PKCE + `SecretStorage` | `identity.launchWebAuthFlow` | core `node/` PKCE + keychain |
| reader transport | webview `postMessage` | in-page calls | no reader (system viewer) |

Each app has exactly one composition root, and only that root instantiates adapters:

- VS Code: `packages/vscode/src/extension.ts`
- Browser: the background worker entry, plus one bootstrap per page (library, reader, popup, options)
- Terminal: `packages/terminal/src/app/context.ts`

## Design system

The design system gives the three apps one look:

- **Tokens** are defined once, as data in `core/src/ui/tokens.ts`: colour roles for light and dark, the type scale, spacing, radii and elevation. The build generates `tokens.css` (`--ls-*` custom properties) from them, and the terminal maps the same colour roles onto its truecolor palette.
- **In VS Code**, a host stylesheet maps each `--ls-*` token to the matching `--vscode-*` variable, so the UI follows the user's VS Code theme. **In the browser**, `tokens.css` supplies values that match VS Code Dark Modern and Light Modern. Components use only `--ls-*`, so the same component looks the same in both hosts.
- **Components** (`core/src/ui/dom/`) and **icons** (one Feather-based inline-SVG set) are shared by the VS Code webviews, the browser pages, the reader and the website.
- **The reader** derives its page themes (light, dark, sepia, high contrast) from the same tokens. Its pdf.js page colours and its CSS read from one table.

## Build and test

- Every app bundles core from source with esbuild, the VS Code extension host included. Core has no build step of its own: its `package.json` `exports` map points at source. Typecheck runs `tsc --noEmit` per runtime tsconfig.
- Tests live next to the package they test (`packages/<pkg>/__tests__/` mirrors `src/`). Core has its own jest suite, and app suites test only app code.
- Lint enforces the rules in [AGENTS.md](../AGENTS.md) that a machine can check:
  - ESLint `max-lines` and `max-lines-per-function`;
  - import boundaries (dependency-cruiser): no app-to-app imports, no neutral → `node/` or `dom/` imports, no deep imports past an `index.ts`;
  - unused files, exports and dependencies (knip).
