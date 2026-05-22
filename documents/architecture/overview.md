# Architecture Overview

LabShelf is organised as a pnpm monorepo. The VS Code extension (`packages/vscode`) is the only user-facing runtime today; `packages/core` now holds every piece of shared, platform-agnostic logic and is consumed by the VS Code package. The `browser` package will be the second consumer of `@labshelf/core`.

## Package layers

- `@labshelf/core` — pure domain logic: shared types (`PaperRecord`, `Annotation`, `BatchImportResult`, `LogEntry`), platform-abstracting interfaces (`IFileSystem`, `IResearchDatabase`, `ILogger`), runtime-neutral `ExtensionEventBus` (Map-based, no `node:events`), `InMemoryResearchDatabase`, the PDF pipeline (`PdfImportParser` + `PdfDocumentOpener` injection, text extraction, CrossRef/arXiv resolver), `BibTeXService` (operates on `IFileSystem`), and the full sync stack (`RemoteProvider`, `IAuthProvider`, `SyncEngine`, `SyncManifest`, `treeScan`, `syncDiff`, `syncApply`, `GoogleDriveProvider`, `DriveClient`, `RemotePathResolver`, WebCrypto `sha256Hex`, `conflictPath`). No `vscode`, no `node:sqlite`, no browser APIs.
- `@labshelf/vscode` — the VS Code extension. Provides the concrete adapters (`VscodeFileSystem` for `IFileSystem`, `VscodeLocalFileSystem` for the sync engine's `LocalFileSystem`, `NodePdfOpener` for `PdfDocumentOpener`, `SqliteResearchDatabase`, `GoogleDriveAuth` implementing `IAuthProvider`), the workspace logger, UI providers (`LibraryTreeDataProvider`, `ListWebviewPanel`, `PdfViewerPanel`), commands, and the composition root in `extension.ts`. Depends on `@labshelf/core`.
- `@labshelf/ai` — AI provider abstraction and paper summariser (planned).
- `@labshelf/latex` — LaTeX cite-key formatter and bib sync (planned).
- `@labshelf/browser` — Chrome + Firefox WebExtension (MV3). The shell exists today: `platform/browserApi` (webextension-polyfill re-export), `platform/logger` (`BrowserLogger : ILogger` backed by a ring buffer in `storage.local`), `platform/runtimeMessages` (discriminated message envelope), a service-worker / non-persistent background script, and placeholder popup, options, and library-page surfaces. The build is an esbuild script that produces `dist/chrome/` and `dist/firefox/` from a single TypeScript source tree, picking the per-target manifest. Phase 2+ will add `BrowserDriveAuth` (`IAuthProvider`), `IndexedDbFileSystem` (`IFileSystem` + sync `LocalFileSystem`), a browser-side `PdfDocumentOpener`, capture flow, and the Paperpile-style library page — all consuming the same `PdfImportParser`, `BibTeXService`, and `SyncEngine` from `@labshelf/core`.

## Control flow

1. The extension starts in `packages/vscode/src/extension.ts`.
2. Concrete adapters are instantiated: `FileSystemService`, `VscodeFileSystem`, `SqliteResearchDatabase`, `WorkspaceLogger`, `NodePdfOpener`.
3. Core services are composed with those adapters via constructor injection: `new PdfImportParser(new NodePdfOpener())`, `new BibTeXService(new VscodeFileSystem())`, `new PaperService(...)`.
4. `LibraryTreeDataProvider` and `ListWebviewPanel` are registered after services are ready.
5. User actions trigger commands or webview messages.
6. Commands call `PaperService` or related services.
7. `PaperService` updates the database, writes artifacts via the core BibTeX service, and emits events on the core `ExtensionEventBus`.
8. UI components listen for those events and refresh themselves.
9. `SyncController` wires the core `SyncEngine` with `VscodeLocalFileSystem`, `GoogleDriveAuth`, and `createGoogleDriveProvider` from core.

## Key design rule

`packages/core` must not import `vscode`, `node:sqlite`, `node:http`, `node:fs`, `node:crypto` (use Web Crypto on `globalThis`), or browser APIs. Platform dependencies are expressed as interfaces (`IFileSystem`, `IResearchDatabase`, `ILogger`, `LocalFileSystem`, `PdfDocumentOpener`, `IAuthProvider`) and injected by the consuming package. UI code does not own domain logic — it triggers commands and reacts to events.
