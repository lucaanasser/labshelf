# Architecture Overview

LabShelf is organised as a pnpm monorepo. `packages/core` holds every piece of shared, platform-agnostic logic, and has two consumers: the VS Code extension (`packages/vscode`) and the browser extension (`packages/browser`).

## Package layers

- `@labshelf/core` — pure domain logic: shared types (`PaperRecord`, `Annotation`, `BatchImportResult`, `LogEntry`), platform-abstracting interfaces (`IFileSystem`, `IResearchDatabase`, `ILogger`), runtime-neutral `ExtensionEventBus` (Map-based, no `node:events`), `InMemoryResearchDatabase`, the PDF pipeline (`PdfImportParser` + `PdfDocumentOpener` injection, text extraction, CrossRef/arXiv resolver), `BibTeXService` (operates on `IFileSystem`), and the full sync stack (`RemoteProvider`, `IAuthProvider`, `SyncEngine`, `SyncManifest`, `treeScan`, `syncDiff`, `syncApply`, `GoogleDriveProvider`, `DriveClient`, `RemotePathResolver`, WebCrypto `sha256Hex`, `conflictPath`). No `vscode`, no `node:sqlite`, no browser APIs.
- `@labshelf/vscode` — the VS Code extension. Provides the concrete adapters (`VscodeFileSystem` for `IFileSystem`, `VscodeLocalFileSystem` for the sync engine's `LocalFileSystem`, `NodePdfOpener` for `PdfDocumentOpener`, `TesseractOcrEngine` for `PdfOcrEngine`, `SqliteResearchDatabase`, `GoogleDriveAuth` implementing `IAuthProvider`), the workspace logger, UI providers (`LibraryTreeDataProvider`, `ListWebviewPanel`, `PdfViewerPanel`), commands, the AI subsystem (`src/ai/`: ONNX/CLIP runtime, hash fallback, model downloader, SQLite vector store, indexer with FIFO queue, `AiService` facade), and the composition root in `extension.ts`. Depends on `@labshelf/core` and `@labshelf/ai`.
- `@labshelf/ai` — Pure, platform-agnostic AI primitives: contracts (`IEmbeddingProvider`, `IVectorStore`, `ILanguageModel`), chunking, heuristic NLP (method/dataset/code-repo/reproducibility/compute/citation/claim detectors, Flesch-Kincaid difficulty scorer, title dedup), RAG primitives (cosine, top-k retrieve, stance detection, MMR rerank), declarative ingestion pipeline, analysis (heatmap aggregation, citation gap detection, bib audit), and a Semantic Scholar client. No platform deps. See `documents/specs/ai/foundation.spec.yaml`.
- `@labshelf/latex` — LaTeX cite-key formatter and bib sync (planned).
- `@labshelf/browser` — Chrome + Firefox WebExtension (MV3). Built on the same core: `platform/browserApi` (webextension-polyfill re-export), `platform/logger` (`BrowserLogger : ILogger` backed by a ring buffer in `storage.local`), `platform/runtimeMessages` (discriminated message envelope), and a service-worker / non-persistent background script. On top of that sit `BrowserDriveAuth` (`IAuthProvider`), `IndexedDbFileSystem` and `IdbManifestFileSystem` (`IFileSystem` + sync `LocalFileSystem` over IndexedDB), the capture flow with its resolver chain (arXiv, CrossRef, PubMed, Unpaywall, page hints), `BrowserSyncController` with alarm-, idle- and debounce-driven auto-sync, and the Paperpile-style library page — all consuming the same `BibTeXService` and `SyncEngine` from `@labshelf/core`. The build is an esbuild script that produces `dist/chrome/` and `dist/firefox/` from a single TypeScript source tree, picking the per-target manifest. It needs a local `src/sync/auth/oauthConfig.ts`, copied from the committed `.example` file.

## Control flow

1. The extension starts in `packages/vscode/src/extension.ts`.
2. The library root is resolved; without one, activation continues and offers `labshelf.configureLibrary` instead of blocking.
3. Concrete adapters are instantiated: `FileSystemService`, `VscodeFileSystem`, `SqliteResearchDatabase` (falling back to `InMemoryResearchDatabase`), `WorkspaceLogger`, `NodePdfOpener`, and `TesseractOcrEngine` when OCR is enabled.
4. Core services are composed with those adapters via constructor injection: `new PdfImportParser(new NodePdfOpener(), { ocr })`, `new BibTeXService(new VscodeFileSystem())`, `new PaperService(...)`.
5. `LibraryTreeDataProvider` and `ListWebviewPanel` are registered after services are ready.
6. User actions trigger commands or webview messages.
7. Commands call `PaperService` or related services.
8. `PaperService` updates the database, writes artifacts via the core BibTeX service, and emits events on the core `ExtensionEventBus`.
9. UI components listen for those events and refresh themselves.
10. `SyncController` wires the core `SyncEngine` with `VscodeLocalFileSystem`, `GoogleDriveAuth`, and `createGoogleDriveProvider` from core.

## Key design rule

`packages/core` must not import `vscode`, `node:sqlite`, `node:http`, `node:fs`, `node:crypto` (use Web Crypto on `globalThis`), or browser APIs. Platform dependencies are expressed as interfaces (`IFileSystem`, `IResearchDatabase`, `ILogger`, `LocalFileSystem`, `PdfDocumentOpener`, `PdfOcrEngine`, `IAuthProvider`) and injected by the consuming package. UI code does not own domain logic — it triggers commands and reacts to events.
