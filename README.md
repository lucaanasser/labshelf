# LabShelf

A local-first research operating system built as a VS Code extension. LabShelf manages academic papers — importing PDFs, extracting metadata, generating BibTeX artifacts, and organising everything into folders — all stored in a library directory you choose, with no cloud dependency.

---

## Overview

LabShelf follows a Zotero-style tree + tab interface:

- **Activity bar sidebar** — a tree of folders that mirrors the real directory structure under `papers/`, plus placeholder sections for upcoming Writing, Reading, Insights, Assist and Agents surfaces.
- **Editor tab panel** — a searchable, sortable paper list with a details sidebar showing title, authors, abstract, cite key, status, and attachments.

Your papers live as ordinary folders and PDFs on disk. A SQLite index and the application log sit in a hidden `.research/` folder beside them. No account and no internet connection are required for core use; Google Drive sync is opt-in.

---

## Repository structure

This is a [pnpm](https://pnpm.io) monorepo with five packages:

```
packages/
  core/       @labshelf/core    — shared logic: types, interfaces, event bus, PDF pipeline, BibTeX, full sync engine and Drive client (no VS Code, no Node-only APIs, no browser APIs)
  vscode/     @labshelf/vscode  — VS Code extension: UI, commands, SQLite adapter, filesystem + Drive auth adapters, PDF viewer, OCR, AI subsystem
  ai/         @labshelf/ai      — platform-agnostic AI primitives: chunking, heuristic extractors, RAG, ingestion pipeline, Semantic Scholar client
  latex/      @labshelf/latex   — LaTeX cite-key formatter and bib-sync service (planned; stub only)
  browser/    @labshelf/browser — Chrome + Firefox MV3 WebExtension — standalone library, Drive sync, capture flow, options + auto-sync (see packages/browser/README.md)
```

`@labshelf/core` has no dependency on `vscode`, `node:sqlite`, `node:http`, `node:fs`, `node:crypto`, or any browser API. Every platform-specific concern is implemented as an adapter in the consuming package and injected via constructor (`IFileSystem`, `IResearchDatabase`, `ILogger`, `LocalFileSystem`, `PdfDocumentOpener`, `PdfOcrEngine`, `IAuthProvider`).

---

## Features

| Feature | Status |
|---|---|
| PDF import with metadata extraction (title, authors, DOI, year) | Done |
| CrossRef / arXiv lookup to enrich metadata | Done |
| OCR fallback for scanned PDFs, plus an optional searchable text layer | Done |
| SQLite-backed research database with WAL mode | Done |
| BibTeX artifact generation per paper | Done |
| Folder tree sidebar mirroring the papers directory | Done |
| Paper list panel with details sidebar | Done |
| In-panel search and sortable columns | Done |
| Drag-and-drop import and folder reorganisation | Done |
| Reading-status tracking (Unread / Reading / Done) | Done |
| In-editor PDF viewer with themes and highlight annotations | Done |
| Google Drive sync (manual and scheduled) | Done |
| Semantic search and AI paper indexing | Done (`@labshelf/ai`) |
| Structured application log | Done |
| Paper delete with optional file removal | Done |
| Notes and tags UI | Planned (`AnnotationType` covers them; no UI yet) |
| Writing / Reading / Insights / Assist / Agents sidebar sections | Planned (placeholder trees only) |
| LaTeX cite-key insertion and bib sync | Planned (`@labshelf/latex`) |
| Browser extension companion (Chrome + Firefox) | Done (`@labshelf/browser`) |

---

## Architecture

### Layer boundaries

```
packages/core
  ├── types/         — PaperRecord, Annotation, BatchImportResult, LogEntry
  ├── events/        — ExtensionEventBus (Map-based), EVENTS constant map
  ├── io/            — PdfImportParser, BibTeXService (accept IFileSystem, not vscode.workspace.fs)
  ├── db/            — IResearchDatabase interface, InMemoryResearchDatabase
  ├── library/       — folder path helpers
  ├── sync/          — SyncEngine, SyncManifest, GoogleDriveProvider, IAuthProvider
  └── interfaces/    — IFileSystem, ILogger

packages/vscode
  ├── extension.ts   — wires the full dependency graph
  ├── db/            — SqliteResearchDatabase (node:sqlite, stays here) + db/ai stores
  ├── storage/       — VscodeFileSystem adapter, LibraryPaths, PaperDataStore
  ├── ui/            — LibraryTreeDataProvider, ListWebviewPanel, SettingsWebviewPanel
  ├── pdf/           — NodePdfOpener, TesseractOcrEngine, SearchablePdfBuilder
  ├── pdf-viewer/    — PdfViewerPanel, ThemeManager, AnnotationManager
  ├── ai/            — embedding runtime, indexer, AiService
  └── commands/      — registerCommands, registerAiCommands
```

### Design rules

- `packages/core` must not import `vscode`, `node:sqlite`, or browser APIs.
- `packages/vscode/src/db/` is the only place `node:sqlite` is allowed.
- Every service in `packages/core` receives its dependencies via constructor (no singletons, no ambient globals).
- UI code owns presentation; it triggers commands and listens to events but does not own persistence.
- Events (`paper:added`, `paper:updated`, `paper:deleted`) are the only coupling between services and UI.

---

## Getting started

### Prerequisites

- Node.js 22.13 or later — `node:sqlite` and `pdfjs-dist` both require it
- pnpm 9 or later

```bash
npm install -g pnpm
```

### Install and build

```bash
pnpm install
pnpm --filter "@labshelf/vscode..." build
```

The `...` suffix builds `@labshelf/core` and `@labshelf/ai` first, in dependency order.

### Launch the extension

Open this repository in VS Code and press **F5**. This runs the `build:vscode` task and opens an Extension Development Host with the LabShelf sidebar available. On first run, use **LabShelf: Configure Library** to choose where your library lives.

### Run tests

```bash
pnpm --filter @labshelf/vscode test
```

### Type-check all packages

```bash
pnpm -r typecheck
```

`@labshelf/browser` additionally needs a local `src/sync/auth/oauthConfig.ts`, copied from the committed `.example` file, before it will type-check or build. See [`packages/browser/README.md`](packages/browser/README.md).

---

## Library layout

LabShelf stores everything under a library root you pick during setup:

```
<library root>/
  papers/
    <your folders>/
      <cite-key>/
        paper.pdf
        metadata.yaml
        bib.bib
  .research/
    index.sqlite
    papers/
      <paper-id>/
        data.json      # annotations and theme
    logs/
      app.log
    sync/              # local per-provider sync state
```

`papers/` is yours to organise — the sidebar tree mirrors whatever folder structure you create there. Each imported paper gets its own folder named after its cite key. The SQLite index, per-paper sidecars and logs are kept out of the way in `.research/`.

---

## Documentation

Detailed documentation lives in [`documents/`](documents/README.md):

- [`architecture/overview.md`](documents/architecture/overview.md) — how the layers fit together
- [`rules/architecture.md`](documents/rules/architecture.md) — invariants to preserve while changing the codebase
- [`reference/modules.md`](documents/reference/modules.md) — service-by-service explanation
- [`reference/directories.md`](documents/reference/directories.md) — what lives where
- [`flows/import-and-library.md`](documents/flows/import-and-library.md) — paper ingestion from command to database
- [`specs/`](documents/specs/) — feature specs in YAML format
