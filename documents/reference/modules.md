# Module Reference

This page describes the main source modules in natural language.

## `packages/vscode/src/extension.ts`

Entry point of the extension. Resolves the library root (running the setup wizard when none is configured), instantiates the concrete adapters (`VscodeFileSystem`, `SqliteResearchDatabase`, `WorkspaceLogger`, `NodePdfOpener`, `TesseractOcrEngine`), composes the core services with those adapters, registers the library tree, the placeholder sidebar sections, the list panel, the settings panel, the sync controller, and all commands.

Activation never blocks: when no library is configured, the extension still loads and shows an information message offering `labshelf.configureLibrary`. Services are built lazily on the first command that needs them.

## `packages/vscode/src/core/paperService.ts`

Main paper lifecycle service. Receives imported PDFs, persists paper records, copies the file into the library, writes BibTeX and metadata artifacts, updates statuses, moves papers and folders, and deletes papers.

Main functions:

- `addPaperFromUri(sourceUri, targetParentDir?)` — import one PDF into the library
- `addPapersFromUris(...)` — batch import with per-file success/failure reporting
- `listPapers()` — read the current library from the database
- `listUnresolvedPapers()` — papers still missing bibliographic metadata
- `applyResolvedMetadata(paperId, metadata)` — write metadata fetched from CrossRef/arXiv
- `refreshMetadataFromPdf(paperId)` — re-run extraction against the stored PDF
- `makeSearchable(paperId, hooks?)` — add an OCR text layer to a scanned PDF
- `resolvePdfUri(paperId)` — locate a paper's `paper.pdf` on disk
- `updatePaperStatus(paperId, status)` — change reading state
- `movePapers(paperIds, targetDir)` / `moveFolder(dirPath, targetParentDir)` — reorganise the tree
- `relocatePapersUnder(oldDir, newDir)` / `removePapersUnder(dirPath)` — keep the index in sync after folder renames and deletions
- `deletePaper(paperId, deleteFiles)` — remove a paper from the library
- `regenerateBibTeX()` — rewrite BibTeX artifacts for all papers

## `packages/core/src/io/pdf/`

PDF metadata extraction, split into focused modules. This pipeline lives in `@labshelf/core` so the browser extension can reuse it:

- `parser.ts` — `PdfImportParser` entry point; orchestrates the extraction pipeline
- `extractor.ts` — raw text and metadata extraction from PDF bytes
- `textExtraction.ts` — page text and font-size-aware title blocks
- `identifiers.ts` — DOI, arXiv id and ISBN recognition
- `xmp.ts` — XMP packet parsing, where publishers put the real bibliographic fields
- `localSignals.ts` — heuristics over the front matter (section headings, author lines)
- `registries.ts` / `resolver.ts` — CrossRef and arXiv lookups to complete bibliographic fields
- `merge.ts` — precedence rules when several sources disagree
- `types.ts` — shared types for the PDF pipeline (`ParsedPdfImport`, `PdfDocumentLike`, `PdfOcrEngine`, etc.)

`PdfImportParser.parse(pdfBytes, fileStem)` takes a `PdfDocumentOpener` (not `pdfjs-dist` directly) and returns parsed metadata including title, cite key, authors, year, and bibliographic fields. An optional `PdfOcrEngine` is used only when the text layer is missing or unreadable.

## `packages/vscode/src/pdf/`

The Node-side PDF adapters the core pipeline is injected with:

- `nodePdfOpener.ts` — `PdfDocumentOpener` backed by `pdfjs-dist`; installs the `DOMMatrix` and `navigator` polyfills and runs the worker in-process
- `pdfjsNodeEnvironment.ts` — `getDocument` options that make pdfjs behave as a Node library inside the extension host (disk-backed CMaps, standard fonts and wasm, native canvas factory)
- `tesseractOcrEngine.ts` — `PdfOcrEngine` that rasterizes pages and reads them with `tesseract.js`
- `searchablePdfBuilder.ts` — adds an invisible text layer to a scanned PDF so it can be searched and selected

## `packages/vscode/src/commands/registerCommands.ts`

Exposes user-facing commands callable from menus, buttons, or the command palette.

Main commands:

- `labshelf.addPaper`
- `labshelf.openPaper`
- `labshelf.searchLibrary`
- `labshelf.generateBibTeX`
- `labshelf.rebuildIndex`
- `labshelf.openSidebar`
- `labshelf.openPaperPdf`
- `labshelf.openPaperFolder`
- `labshelf.copyCitation`
- `labshelf.deletePaper`
- `labshelf.fetchMetadata`
- `labshelf.resolveMissingMetadata`
- `labshelf.makeSearchable`
- `labshelf.makeLibrarySearchable`

Folder and library commands (`labshelf.newFolder`, `labshelf.newFolderAtRoot`, `labshelf.renameFolder`, `labshelf.deleteFolder`, `labshelf.addPaperHere`, `labshelf.library.refresh`, `labshelf.configureLibrary`, `labshelf.openSettings`, `labshelf.openListTab`, `labshelf.openPdfViewer`, `labshelf.collapseAllSections`) are registered directly in `extension.ts`, because they close over the tree provider and the library root. AI commands live in `registerAiCommands.ts`, and sync commands (`labshelf.sync.*`) delegate to `SyncController`.

## `packages/vscode/src/ui/library/libraryTreeDataProvider.ts`

Builds the library tree in the activity bar. The tree mirrors the real directory structure under `papers/`: an "All Papers" root plus one row per folder on disk. Rows show a paper count, open in the list panel when clicked, accept dropped PDFs, and accept dragged folders. Auto-refreshes on paper events, coalescing bursts so a folder move triggers one refresh rather than one per paper.

Main functions:

- `getTreeItem(node)` — convert a folder node into a VS Code tree item
- `getChildren(node?)` — return root or nested folder nodes
- `getParent(node)` — required for `reveal()` when syncing the tree to the list panel
- `setPapersRoot(uri)` — repoint the tree after the library is configured
- `refresh()` — debounced full refresh

Folder reading and counting live in the sibling modules `collectionFolders.ts` and `folderNavigation.ts`. Drag-and-drop is handled by `LibraryDragAndDropController` in the same file.

## `packages/vscode/src/ui/list/listWebviewPanel.ts`

Owns the central editor tab showing the paper list with a details sidebar (Zotero-style). Singleton — reused across folder switches.

Main responsibilities:

- create or reveal the panel
- render the current folder with title, creators, status, and attachments
- handle webview messages (open PDF, copy key, update status)
- refresh on `paper:added`, `paper:updated`, `paper:deleted` events
- follow folder renames and moves so the open panel does not go stale

The HTML is assembled from `template.ts` and its siblings (`template.css.ts`, `template.icons.ts`, `template.script.ts`, `template.detail.script.ts`).

## `packages/vscode/src/ui/settings/settingsWebviewPanel.ts`

The settings editor tab. It is the only place to manage the Google Drive connection, the auto-sync interval, and the library location. Drive used to have its own sidebar tree; it does not any more.

## `packages/vscode/src/storage/paths/libraryPaths.ts`

Defines where LabShelf stores its data, relative to an arbitrary library root chosen by the user.

Main functions:

- `researchRoot()` — `.research/` folder
- `papersRoot()` — `papers/`, the user-visible tree of paper folders
- `logsRoot()` — `.research/logs/`
- `indexPath()` — `.research/index.sqlite`
- `appLogPath()` — `.research/logs/app.log`
- `paperDataDir(paperId)` / `paperDataPath(paperId)` — `.research/papers/<id>/data.json`, the sidecar holding a paper's annotations and theme
- `syncRoot()` / `syncDir()` — `.research/sync/`, local per-provider sync state

`workspacePaths.ts` in the same folder is only a backward-compatibility re-export of `LibraryPaths` under its former `WorkspacePaths` name.

## `packages/vscode/src/ai/`

The AI subsystem, built on the platform-agnostic primitives in `@labshelf/ai`:

- `runtime/` — embedding providers (ONNX-backed and a deterministic hash fallback), model download and on-disk model paths
- `pdf/` — PDF text extraction and content hashing feeding the ingestion pipeline
- `indexer/` — `AiIndexer` plus a FIFO queue that isolates per-paper failures
- `service/` — the `AiService` facade used by the `labshelf.ai.*` commands

Vector and metadata persistence lives in `packages/vscode/src/db/ai/`, on the same SQLite connection as the main index.
