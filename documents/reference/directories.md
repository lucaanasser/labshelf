# Directory Reference

This page explains the purpose of the main directories in the repository.

## `packages/core/src/`

Platform-agnostic domain code. No `vscode`, no `node:sqlite`, no browser APIs.

- `types/` — `PaperRecord`, `PaperStatus`, `Annotation` (and its position/type/colour types), `PdfTheme`, `BatchImportResult`, `LogEntry`
- `events/` — `ExtensionEventBus` (Map-based, runtime-neutral), `EVENTS` constant map
- `io/` — the PDF pipeline (`io/pdf/`: `PdfImportParser`, extraction, identifiers, XMP, CrossRef/arXiv resolution) and `BibTeXService` (`io/bibtex/`)
- `db/` — `IResearchDatabase` interface, `InMemoryResearchDatabase`
- `interfaces/` — `IFileSystem`, `ILogger`, `IResearchDatabase`
- `library/` — `folderService`, shared folder-path helpers
- `sync/` — the full sync stack, split into:
  - `core/` — `SyncEngine`, `SyncManifest`, and the `diffNamespace`, `applyOperations`,
    `scanLocalTree`/`scanRemoteTree` steps plus the shared sync types
  - `provider/` — `RemoteProvider`, `RemotePathResolver`, `IAuthProvider`
  - `drive/` — `DriveClient`, `createGoogleDriveProvider`
  - `util/` — `conflictPath`, `sha256Hex` (Web Crypto, not `node:crypto`)

## `packages/vscode/src/`

The VS Code extension.

- `extension.ts` — entry point; wires all adapters and services
- `core/` — `PaperService`, `WorkspaceLogger`
- `db/` — `SqliteResearchDatabase` (`node:sqlite` is only allowed here), plus `db/ai/` for the vector store, AI metadata, reading events and the Semantic Scholar cache
- `storage/` — `VscodeFileSystem`, split into:
  - `paths/` — `LibraryPaths`, and `libraryLocation` (`resolveLibraryRoot`, `ensureLibraryStructure`,
    `runLibrarySetupWizard`); `WorkspacePaths` is a legacy alias of `LibraryPaths`
  - `data/` — `PaperDataStore`, `LibraryIndexer`, `migrateSidecarsFromDb`
- `ui/` — webview panels and tree providers, split into:
  - `library/` — `LibraryTreeDataProvider` (folder tree mirroring `papers/`), drag-and-drop, folder reading and counting
  - `list/` — `ListWebviewPanel`, HTML template
  - `settings/` — `SettingsWebviewPanel` (Drive connection, sync interval, library location)
  - `sidebar/` — placeholder tree providers for the Writing, Reading, Insights, Assist and Agents sections
- `sync/` — the VS Code side of sync only:
  - `adapter/` — `SyncController`, `VscodeLocalFileSystem`
  - `auth/` — `GoogleDriveAuth` (implements the core `IAuthProvider`)
- `pdf/` — Node-side PDF adapters: `NodePdfOpener`, `pdfjsNodeEnvironment`, `TesseractOcrEngine`, `SearchablePdfBuilder`
- `pdf-viewer/` — in-editor PDF reader, split across three layers:
  - host-side controllers: `PdfViewerPanel.ts`, `renderer/PdfRenderer.ts` (HTML shell only), `ThemeManager.ts`, `AnnotationManager.ts`, `readerPrefs.ts`, `config.ts`
  - `shared/` — DOM-free helpers compiled by both TypeScript programs and jest-tested (`protocol.ts`, `readingState.ts`, `themePresets.ts`, `citationFormat.ts`, `annotationsMarkdown.ts`)
  - `webview/` — the bundled reader runtime, packaged with esbuild by `build/reader.mjs` into `dist/reader/reader.{js,css}`. `webview/logic/` is pure (jest-tested); `webview/ui/` is DOM-touching (excluded from the main tsc program and from jest coverage); `webview/main.ts` is the bundle entry. pdf.js is loaded at runtime by dynamic import of webview URIs (types only at build time)
- `ai/` — embedding runtime, PDF text extraction, indexer queue, and the `AiService` facade
- `commands/` — `registerCommands`, `registerAiCommands`, and the import/OCR progress helpers

## `packages/ai/`

Pure, platform-agnostic AI primitives consumed by the VS Code package: contracts (`IEmbeddingProvider`, `IVectorStore`, `ILanguageModel`), chunking, heuristic NLP extractors, RAG primitives (cosine, top-k retrieval, stance detection, MMR rerank), the declarative ingestion pipeline, analysis helpers, and a Semantic Scholar client. No platform dependencies.

## `packages/browser/`

Chrome + Firefox MV3 WebExtension. Contains the background service worker, the capture flow and its resolver chain (arXiv, CrossRef, PubMed, Unpaywall, page hints), IndexedDB-backed storage, Drive auth and sync, and the popup, options and library-page surfaces. Built with an esbuild script that emits `dist/chrome/` and `dist/firefox/` from a single TypeScript source tree.

Requires a local `src/sync/auth/oauthConfig.ts`, copied from the committed `.example` file. It is gitignored; see `packages/browser/README.md`.

## `packages/latex/`

Planned package. Only a `src/index.ts` stub and a `tsconfig.json` extending the root base config.

## `documents/`

Human-readable documentation, plans, specs, and architectural notes.

## `packages/vscode/__tests__/`

Automated tests organised by layer, mirroring `src/` (core, db, storage, pdf, pdf-viewer, bibtex, commands, sync, ui, ai).

## `test-workspace/`

Sample workspace used for manual extension-host verification. `.vscode/launch.json` opens it when you press F5.
