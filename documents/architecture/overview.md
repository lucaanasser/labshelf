# Architecture Overview

LabShelf is organised as a pnpm monorepo. The VS Code extension (`packages/vscode`) is the only runnable surface today; the other packages (`core`, `ai`, `latex`, `browser`) are extracted or planned.

## Package layers

- `@labshelf/core` — pure domain logic: types, event bus, PDF parser, BibTeX generator, database interface, `IFileSystem` interface. No `vscode`, no `better-sqlite3`, no browser APIs.
- `@labshelf/vscode` — the VS Code extension. Contains the SQLite adapter, `vscode.workspace.fs` adapter, sidebar tree, list panel, and command registrations. Depends on `@labshelf/core`.
- `@labshelf/ai` — AI provider abstraction and paper summariser (planned).
- `@labshelf/latex` — LaTeX cite-key formatter and bib sync (planned).
- `@labshelf/browser` — browser extension surface (planned).

## Control flow

1. The extension starts in `packages/vscode/src/extension.ts`.
2. Concrete adapters are instantiated: `VsCodeFileSystem`, `SqliteResearchDatabase`, `WorkspaceLogger`.
3. Core services are composed with those ad
4. apters via constructor injection: `PdfImportParser`, `BibTeXService`, `PaperService`.
5. `CollectionsTreeDataProvider` and `ListWebviewPanel` are registered after services are ready.
6. User actions trigger commands or webview messages.
7. Commands call `PaperService` or related services.
8. `PaperService` updates the database, writes artifacts, and emits events.
9. UI components listen for those events and refresh themselves.

## Key design rule

`packages/core` must not import `vscode`, `better-sqlite3`, or browser APIs. Platform dependencies are expressed as interfaces (`IFileSystem`, `IResearchDatabase`, `ILogger`) and injected by the consuming package. UI code does not own domain logic — it triggers commands and reacts to events.
