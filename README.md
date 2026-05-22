# LabShelf

A local-first research operating system built as a VS Code extension. LabShelf manages academic papers — importing PDFs, extracting metadata, generating BibTeX artifacts, and organising everything into collections — all stored inside your workspace with no cloud dependency.

---

## Overview

LabShelf follows a Zotero-style tree + tab interface:

- **Activity bar sidebar** — a tree of collections (My Library, Recently Read, Unfiled, and user-defined folders).
- **Editor tab panel** — a scrollable paper list with a details sidebar showing title, authors, abstract, cite key, status, and attachments.

All data lives in a SQLite database and a flat folder structure inside `.research/` at the workspace root. No account, no sync service, no internet required for core use.

---

## Repository structure

This is a [pnpm](https://pnpm.io) monorepo with five packages:

```
packages/
  core/       @labshelf/core    — shared logic: types, interfaces, event bus, PDF parser, BibTeX, full sync engine and Drive client (no VS Code, no Node-only APIs, no browser APIs)
  vscode/     @labshelf/vscode  — VS Code extension: UI, commands, SQLite adapter, filesystem + Drive auth adapters, NodePdfOpener
  ai/         @labshelf/ai      — AI provider abstraction and paper summariser (planned)
  latex/      @labshelf/latex   — LaTeX cite-key formatter and bib-sync service (planned)
  browser/    @labshelf/browser — Browser extension surface (planned) — will reuse @labshelf/core via its own adapters (IndexedDB filesystem, chrome.identity auth, browser PdfDocumentOpener)
```

`@labshelf/core` has no dependency on `vscode`, `node:sqlite`, `node:http`, `node:fs`, `node:crypto`, or any browser API. Every platform-specific concern is implemented as an adapter in the consuming package and injected via constructor (`IFileSystem`, `IResearchDatabase`, `ILogger`, `LocalFileSystem`, `PdfDocumentOpener`, `IAuthProvider`).

---

## Features

| Feature | Status |
|---|---|
| PDF import with metadata extraction (title, authors, DOI, year) | Done |
| CrossRef / arXiv lookup to enrich metadata | Done |
| SQLite-backed research database with WAL mode | Done |
| BibTeX artifact generation per paper | Done |
| Zotero-style collections sidebar (tree view) | Done |
| Paper list panel with details sidebar | Done |
| Reading-status tracking (Unread / Reading / Done) | Done |
| Custom user collections (create, rename, delete) | Done |
| Structured application log | Done |
| Paper delete with optional file removal | Done |
| Paper-to-collection assignment | Planned |
| Notes and tags UI | Planned (schema exists) |
| In-panel search and sortable columns | Planned |
| Drag-and-drop import in the new tree/tab UI | Planned |
| AI-assisted paper summarisation | Planned (`@labshelf/ai`) |
| LaTeX cite-key insertion and bib sync | Planned (`@labshelf/latex`) |
| Browser extension companion | Planned (`@labshelf/browser`) |

---

## Architecture

### Layer boundaries

```
packages/core
  ├── types/         — PaperRecord, Annotation, Collection, BatchImportResult, LogEntry
  ├── events/        — ExtensionEventBus (node:events), EVENTS constant map
  ├── io/            — PdfImportParser, BibTeXService (accept IFileSystem, not vscode.workspace.fs)
  ├── db/            — IResearchDatabase interface, InMemoryResearchDatabase
  └── interfaces/    — IFileSystem, ILogger

packages/vscode
  ├── extension.ts   — wires the full dependency graph
  ├── db/            — SqliteResearchDatabase (better-sqlite3, stays here)
  ├── storage/       — VsCodeFileSystem adapter, LibraryPaths
  ├── ui/            — CollectionsTreeDataProvider, ListWebviewPanel
  └── commands/      — registerCommands
```

### Design rules

- `packages/core` must not import `vscode`, `better-sqlite3`, or browser APIs.
- `packages/vscode/src/db/` is the only place `better-sqlite3` is allowed.
- Every service in `packages/core` receives its dependencies via constructor (no singletons, no ambient globals).
- UI code owns presentation; it triggers commands and listens to events but does not own persistence.
- Events (`paper:added`, `paper:updated`, `paper:deleted`) are the only coupling between services and UI.

---

## Getting started

### Prerequisites

- Node.js 18 or later
- pnpm 9

```bash
npm install -g pnpm@9
```

### Install and build

```bash
pnpm install
pnpm --filter @labshelf/vscode build
```

### Launch the extension

Open this repository in VS Code and press **F5**. This runs the `build:vscode` task and opens an Extension Development Host with the LabShelf sidebar available.

### Run tests

```bash
pnpm --filter @labshelf/vscode test
```

### Type-check all packages

```bash
pnpm -r typecheck
```

---

## Workspace layout

After first launch, LabShelf creates a `.research/` folder in your open workspace:

```
.research/
  papers/
    <cite-key>/
      paper.pdf
      metadata.yaml
      <cite-key>.bib
  db/
    research.db
  logs/
    app.log
```

Each imported paper gets its own folder named after its cite key. The SQLite database and log are kept separate from the paper files.

---

## Documentation

Detailed documentation lives in [`documents/`](documents/README.md):

- [`architecture/overview.md`](documents/architecture/overview.md) — how the layers fit together
- [`rules/architecture.md`](documents/rules/architecture.md) — invariants to preserve while changing the codebase
- [`reference/modules.md`](documents/reference/modules.md) — service-by-service explanation
- [`flows/import-and-library.md`](documents/flows/import-and-library.md) — paper ingestion from command to database
- [`specs/`](documents/specs/) — feature specs in YAML format
