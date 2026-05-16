# Module Reference

This page describes the main source modules in natural language.

## `packages/vscode/src/extension.ts`

Entry point of the extension. Instantiates all concrete adapters (`VsCodeFileSystem`, `SqliteResearchDatabase`, `WorkspaceLogger`), composes the core services with those adapters, registers the sidebar tree, the list panel, and all commands.

## `packages/vscode/src/core/paperService.ts`

Main paper lifecycle service. Receives imported PDFs, persists paper records, copies the file into the workspace, writes BibTeX and metadata artifacts, updates statuses, and deletes papers.

Main functions:

- `addPaperFromUri(sourceUri)` — import one PDF into the library
- `listPapers()` — read the current library from the database
- `updatePaperStatus(paperId, status)` — change reading state
- `deletePaper(paperId, deleteFiles)` — remove a paper from the library
- `regenerateBibTeX()` — rewrite BibTeX artifacts for all papers

## `packages/core/src/io/pdfImportParser.ts`

Extracts metadata from a source PDF before the paper is stored. Accepts `IFileSystem` (not `vscode.workspace.fs` directly). Attempts to build title, cite key, authors, year, and bibliographic fields from PDF contents; falls back to CrossRef and arXiv lookups.

Main function:

- `PdfImportParser.parse(uri)` — read the PDF and return parsed metadata

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
- `labshelf.openListTab`
- `labshelf.newCollection`
- `labshelf.collections.refresh`
- `labshelf.renameCollection`
- `labshelf.deleteCollection`

## `packages/vscode/src/ui/collectionsTreeDataProvider.ts`

Builds the sidebar tree. Shows built-in virtual collections (My Library, Recently Read, Unfiled), user-created custom collections, paper count badges, and a New Collection button. Auto-refreshes on paper events.

Main functions:

- `getTreeItem(element)` — convert a collection record into a VS Code tree item
- `getChildren(element?)` — return root or nested tree items
- `newCollection()` — prompt and create a custom collection
- `renameCollection(item)` — rename a custom collection
- `deleteCollection(item)` — delete a custom collection

## `packages/vscode/src/ui/listWebviewPanel.ts`

Owns the central editor tab showing the paper list with a details sidebar (Zotero-style). Singleton — reused across collection switches.

Main responsibilities:

- create or reveal the panel
- render the current collection with title, creators, status, and attachments
- handle webview messages (open PDF, copy key, update status)
- refresh on `paper:added`, `paper:updated`, `paper:deleted` events

## `packages/vscode/src/storage/workspacePaths.ts`

Defines where LabShelf stores its data inside the workspace.

Main functions:

- `researchRoot()` — `.research/` folder
- `papersRoot()` — root folder for imported papers
- `logsRoot()` — log directory
- `indexPath()` — SQLite database path
- `appLogPath()` — structured application log path
